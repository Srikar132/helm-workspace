"use server";

import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, galleries, galleryGroups, galleryImages } from "@/lib/db";
import { requireViewerContext } from "@/lib/workspace";
import { canWriteEntries } from "@/lib/permissions";
import { enqueueCloudinaryCleanup, runCleanupJobs } from "@/lib/cloudinary-cleanup";
import { checkRateLimit } from "@/lib/rate-limit";

export type ActionState = { error?: string };

export type GalleryRow = typeof galleries.$inferSelect;
export type GalleryGroupRow = typeof galleryGroups.$inferSelect;
export type GalleryImageRow = typeof galleryImages.$inferSelect;

/** A gallery holds photos AND documents (see lib/gallery-file.ts) — `images`
 *  keeps its name here because the table and every query below still do. */
export type GalleryPreview = { name: string; count: number; images: GalleryImageRow[] };

/** Scopes a gallery lookup by the caller's org — the actual thing stopping
 *  one workspace from touching another's gallery by guessing an id. Every
 *  mutation below calls this first, mirroring docs.ts's getDocProject
 *  ownership-check pattern. */
async function getOwnedGallery(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: galleries.id, name: galleries.name })
    .from(galleries)
    .where(and(eq(galleries.id, id), eq(galleries.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

const nameSchema = z.string().trim().min(1, "Name is required.").max(120, "Keep it under 120 characters.");

export async function createGalleryAction(name: string): Promise<{ error?: string; id?: string }> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`create-gallery:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [gallery] = await db
    .insert(galleries)
    .values({ organizationId: viewer.organizationId, name: parsed.data, createdBy: viewer.userId })
    .returning({ id: galleries.id });

  if (!gallery) return { error: "Could not create the gallery. Please try again." };

  return { id: gallery.id };
}

export async function renameGalleryAction(id: string, name: string): Promise<ActionState> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`rename-gallery:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedGallery(id, viewer.organizationId);
  if (!owned) return { error: "Gallery not found." };

  await db.update(galleries).set({ name: parsed.data, updatedAt: new Date() }).where(eq(galleries.id, id));
  revalidateTag(`gallery:${id}`, { expire: 0 });
  return {};
}

export async function deleteGalleryAction(id: string): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`delete-gallery:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedGallery(id, viewer.organizationId);
  if (!owned) return { error: "Gallery not found." };

  const images = await db
    .select({ cloudinaryPublicId: galleryImages.cloudinaryPublicId })
    .from(galleryImages)
    .where(eq(galleryImages.galleryId, id));

  await db.delete(galleries).where(eq(galleries.id, id));
  revalidateTag(`gallery:${id}`, { expire: 0 });
  revalidateTag(`gallery-groups:${id}`, { expire: 0 });
  revalidateTag(`gallery-images:${id}`, { expire: 0 });

  // The DB row for each cleanup job is written NOW (durable), before the
  // response goes out — the after() call below is just the fast path.
  // Cloudinary getting deleted a few minutes later via the cron sweep is
  // fine; a delete that never gets recorded at all is not.
  const publicIds = images.map((img) => img.cloudinaryPublicId).filter((id): id is string => !!id);
  if (publicIds.length > 0) {
    const jobs = await enqueueCloudinaryCleanup(publicIds);
    after(() => runCleanupJobs(jobs));
  }

  return {};
}

export async function getGalleriesForWorkspace(): Promise<GalleryRow[]> {
  const viewer = await requireViewerContext();
  return db.select().from(galleries).where(eq(galleries.organizationId, viewer.organizationId));
}

export async function getGallery(id: string): Promise<GalleryRow | null> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const [row] = await db
        .select()
        .from(galleries)
        .where(and(eq(galleries.id, id), eq(galleries.organizationId, organizationId)))
        .limit(1);
      return row ?? null;
    },
    ["gallery", id, organizationId],
    { tags: [`gallery:${id}`], revalidate: 300 },
  )();
}

/** Batched lookup for the canvas — one round trip for every gallery widget's
 *  preview instead of one query per widget. Mirrors getDocProjectsByIds. */
export async function getGalleryPreviewsByIds(ids: string[]): Promise<Record<string, GalleryPreview>> {
  if (ids.length === 0) return {};
  const viewer = await requireViewerContext();

  const owned = await db
    .select({ id: galleries.id })
    .from(galleries)
    .where(and(inArray(galleries.id, ids), eq(galleries.organizationId, viewer.organizationId)));
  const ownedIds = owned.map((a) => a.id);
  if (ownedIds.length === 0) return {};

  const previews = await Promise.all(ownedIds.map((id) => getGalleryPreview(id)));
  return Object.fromEntries(ownedIds.map((id, i) => [id, previews[i]]));
}

/** The query backing the canvas fan card — cheap and constant-size
 *  regardless of how many images the gallery actually has. */
export async function getGalleryPreview(galleryId: string): Promise<GalleryPreview> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedGallery(galleryId, organizationId);
      if (!owned) return { name: "", count: 0, images: [] };

      const [images, [{ count }]] = await Promise.all([
        db
          .select()
          .from(galleryImages)
          .where(eq(galleryImages.galleryId, galleryId))
          .orderBy(desc(galleryImages.createdAt))
          .limit(3),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(galleryImages)
          .where(eq(galleryImages.galleryId, galleryId)),
      ]);

      return { name: owned.name, count, images };
    },
    ["gallery-preview", galleryId, organizationId],
    { tags: [`gallery:${galleryId}`], revalidate: 300 },
  )();
}

export async function getGalleryGroups(galleryId: string): Promise<GalleryGroupRow[]> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedGallery(galleryId, organizationId);
      if (!owned) return [];
      return db.select().from(galleryGroups).where(eq(galleryGroups.galleryId, galleryId)).orderBy(asc(galleryGroups.position));
    },
    ["gallery-groups", galleryId, organizationId],
    { tags: [`gallery-groups:${galleryId}`], revalidate: 300 },
  )();
}

export async function createGalleryGroup(galleryId: string, name: string): Promise<{ error?: string; id?: string }> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`create-gallery-group:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedGallery(galleryId, viewer.organizationId);
  if (!owned) return { error: "Gallery not found." };

  const existing = await db
    .select({ position: galleryGroups.position })
    .from(galleryGroups)
    .where(eq(galleryGroups.galleryId, galleryId));
  const nextPosition = existing.length ? Math.max(...existing.map((g) => g.position)) + 1 : 0;

  const [group] = await db
    .insert(galleryGroups)
    .values({ galleryId, name: parsed.data, position: nextPosition })
    .returning({ id: galleryGroups.id });

  revalidateTag(`gallery-groups:${galleryId}`, { expire: 0 });
  return { id: group?.id };
}

export async function renameGalleryGroup(id: string, galleryId: string, name: string): Promise<ActionState> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`rename-gallery-group:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedGallery(galleryId, viewer.organizationId);
  if (!owned) return { error: "Gallery not found." };

  await db.update(galleryGroups).set({ name: parsed.data }).where(and(eq(galleryGroups.id, id), eq(galleryGroups.galleryId, galleryId)));
  revalidateTag(`gallery-groups:${galleryId}`, { expire: 0 });
  return {};
}

export async function deleteGalleryGroup(id: string, galleryId: string): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`delete-gallery-group:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedGallery(galleryId, viewer.organizationId);
  if (!owned) return { error: "Gallery not found." };

  // Images in this group fall back to ungrouped via the FK's
  // onDelete: "set null" — deleting a group never deletes photos.
  await db.delete(galleryGroups).where(and(eq(galleryGroups.id, id), eq(galleryGroups.galleryId, galleryId)));
  revalidateTag(`gallery-groups:${galleryId}`, { expire: 0 });
  revalidateTag(`gallery-images:${galleryId}`, { expire: 0 });
  return {};
}

const addItemSchema = z.object({
  galleryId: z.string().uuid(),
  url: z.string().url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  name: z.string().trim().max(200).optional(),
  kind: z.enum(["image", "pdf", "word"]).default("image"),
  // Which Cloudinary resource type actually holds the asset — a Word file is
  // "raw", everything else "image". Recorded per row so a delete is exact.
  resourceType: z.enum(["image", "raw", "video"]).default("image"),
  bytes: z.number().int().nonnegative().optional(),
  cloudinaryPublicId: z.string().optional(),
  groupId: z.string().uuid().optional(),
});

export async function addItemToGallery(
  input: z.input<typeof addItemSchema>,
): Promise<{ error?: string; id?: string }> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid file." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`add-image:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedGallery(parsed.data.galleryId, viewer.organizationId);
  if (!owned) return { error: "Gallery not found." };

  const [image] = await db
    .insert(galleryImages)
    .values({
      galleryId: parsed.data.galleryId,
      groupId: parsed.data.groupId ?? null,
      url: parsed.data.url,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
      name: parsed.data.name || null,
      kind: parsed.data.kind,
      resourceType: parsed.data.resourceType,
      bytes: parsed.data.bytes ?? 0,
      cloudinaryPublicId: parsed.data.cloudinaryPublicId ?? null,
      createdBy: viewer.userId,
    })
    .returning({ id: galleryImages.id });

  revalidateTag(`gallery-images:${parsed.data.galleryId}`, { expire: 0 });
  revalidateTag(`gallery:${parsed.data.galleryId}`, { expire: 0 });
  return { id: image?.id };
}

/** Every image mutation below re-derives the owning gallery from the image
 *  row itself, then checks that gallery against the caller's org — same
 *  "look up the parent, then verify" shape as docs.ts's updateDocPage. */
async function getOwnedImageGalleryId(imageId: string, organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ galleryId: galleryImages.galleryId })
    .from(galleryImages)
    .where(eq(galleryImages.id, imageId))
    .limit(1);
  if (!row) return null;
  const owned = await getOwnedGallery(row.galleryId, organizationId);
  return owned ? row.galleryId : null;
}

export async function renameImageAction(id: string, name: string): Promise<ActionState> {
  const parsed = z.string().trim().max(200).safeParse(name);
  if (!parsed.success) return { error: "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`rename-image:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const galleryId = await getOwnedImageGalleryId(id, viewer.organizationId);
  if (!galleryId) return { error: "Image not found." };

  await db.update(galleryImages).set({ name: parsed.data || null }).where(eq(galleryImages.id, id));
  revalidateTag(`gallery-images:${galleryId}`, { expire: 0 });
  return {};
}

export async function deleteImageAction(id: string): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`delete-image:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [row] = await db
    .select({ galleryId: galleryImages.galleryId, cloudinaryPublicId: galleryImages.cloudinaryPublicId })
    .from(galleryImages)
    .where(eq(galleryImages.id, id))
    .limit(1);
  if (!row) return { error: "Image not found." };
  const owned = await getOwnedGallery(row.galleryId, viewer.organizationId);
  if (!owned) return { error: "Image not found." };

  await db.delete(galleryImages).where(eq(galleryImages.id, id));
  revalidateTag(`gallery-images:${row.galleryId}`, { expire: 0 });
  revalidateTag(`gallery:${row.galleryId}`, { expire: 0 });

  if (row.cloudinaryPublicId) {
    const jobs = await enqueueCloudinaryCleanup([row.cloudinaryPublicId]);
    after(() => runCleanupJobs(jobs));
  }

  return {};
}

export async function moveImageToGroupAction(id: string, groupId: string | null): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`move-image:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const galleryId = await getOwnedImageGalleryId(id, viewer.organizationId);
  if (!galleryId) return { error: "Image not found." };

  await db.update(galleryImages).set({ groupId }).where(eq(galleryImages.id, id));
  revalidateTag(`gallery-images:${galleryId}`, { expire: 0 });
  return {};
}

export async function copyImageAction(id: string, targetGroupId?: string | null): Promise<{ error?: string; id?: string }> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`copy-image:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [row] = await db.select().from(galleryImages).where(eq(galleryImages.id, id)).limit(1);
  if (!row) return { error: "Image not found." };
  const owned = await getOwnedGallery(row.galleryId, viewer.organizationId);
  if (!owned) return { error: "Image not found." };

  // Duplicates the row pointing at the same Cloudinary URL — no re-upload.
  // Deliberately omits cloudinaryPublicId so deleting either copy never
  // destroys the other's underlying asset.
  const [copy] = await db
    .insert(galleryImages)
    .values({
      galleryId: row.galleryId,
      groupId: targetGroupId ?? row.groupId,
      url: row.url,
      width: row.width,
      height: row.height,
      name: row.name,
      kind: row.kind,
      resourceType: row.resourceType,
      bytes: row.bytes,
      createdBy: viewer.userId,
    })
    .returning({ id: galleryImages.id });

  revalidateTag(`gallery-images:${row.galleryId}`, { expire: 0 });
  revalidateTag(`gallery:${row.galleryId}`, { expire: 0 });
  return { id: copy?.id };
}

export async function bulkDeleteImagesAction(ids: string[]): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  if (ids.length === 0) return {};
  const rateLimit = await checkRateLimit(`bulk-delete-images:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const rows = await db
    .select({ id: galleryImages.id, galleryId: galleryImages.galleryId, cloudinaryPublicId: galleryImages.cloudinaryPublicId })
    .from(galleryImages)
    .where(inArray(galleryImages.id, ids));

  const galleryIds = [...new Set(rows.map((r) => r.galleryId))];
  const ownedGalleries = await db
    .select({ id: galleries.id })
    .from(galleries)
    .where(and(inArray(galleries.id, galleryIds), eq(galleries.organizationId, viewer.organizationId)));
  const ownedSet = new Set(ownedGalleries.map((a) => a.id));
  const deletable = rows.filter((r) => ownedSet.has(r.galleryId));
  if (deletable.length === 0) return {};

  await db.delete(galleryImages).where(inArray(galleryImages.id, deletable.map((r) => r.id)));
  for (const affectedGalleryId of new Set(deletable.map((r) => r.galleryId))) {
    revalidateTag(`gallery-images:${affectedGalleryId}`, { expire: 0 });
    revalidateTag(`gallery:${affectedGalleryId}`, { expire: 0 });
  }

  const publicIds = deletable.map((r) => r.cloudinaryPublicId).filter((id): id is string => !!id);
  if (publicIds.length > 0) {
    const jobs = await enqueueCloudinaryCleanup(publicIds);
    after(() => runCleanupJobs(jobs));
  }

  return {};
}

export async function bulkMoveImagesAction(ids: string[], groupId: string | null): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  if (ids.length === 0) return {};
  const rateLimit = await checkRateLimit(`bulk-move-images:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const rows = await db.select({ id: galleryImages.id, galleryId: galleryImages.galleryId }).from(galleryImages).where(inArray(galleryImages.id, ids));
  const galleryIds = [...new Set(rows.map((r) => r.galleryId))];
  const ownedGalleries = await db
    .select({ id: galleries.id })
    .from(galleries)
    .where(and(inArray(galleries.id, galleryIds), eq(galleries.organizationId, viewer.organizationId)));
  const ownedSet = new Set(ownedGalleries.map((a) => a.id));
  const movableRows = rows.filter((r) => ownedSet.has(r.galleryId));
  if (movableRows.length === 0) return {};

  await db.update(galleryImages).set({ groupId }).where(inArray(galleryImages.id, movableRows.map((r) => r.id)));
  for (const affectedGalleryId of new Set(movableRows.map((r) => r.galleryId))) {
    revalidateTag(`gallery-images:${affectedGalleryId}`, { expire: 0 });
  }
  return {};
}

export type GalleryImagesPage = { images: GalleryImageRow[]; nextCursor: string | null };

/** Cursor-paginated so a huge gallery never loads in one shot — cursor is
 *  "createdAt,id" (id as a tiebreaker for same-millisecond uploads). */
export async function getGalleryImages(
  galleryId: string,
  opts: { groupId?: string | null; cursor?: string | null; limit?: number } = {},
): Promise<GalleryImagesPage> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedGallery(galleryId, organizationId);
      if (!owned) return { images: [], nextCursor: null };

      const limit = Math.min(opts.limit ?? 60, 120);
      const conditions = [eq(galleryImages.galleryId, galleryId)];
      if (opts.groupId === null) conditions.push(sql`${galleryImages.groupId} is null`);
      else if (opts.groupId) conditions.push(eq(galleryImages.groupId, opts.groupId));

      if (opts.cursor) {
        const [cursorCreatedAt, cursorId] = opts.cursor.split(",");
        if (cursorCreatedAt && cursorId) {
          conditions.push(
            or(
              lt(galleryImages.createdAt, new Date(cursorCreatedAt)),
              and(eq(galleryImages.createdAt, new Date(cursorCreatedAt)), lt(galleryImages.id, cursorId)),
            )!,
          );
        }
      }

      const rows = await db
        .select()
        .from(galleryImages)
        .where(and(...conditions))
        .orderBy(desc(galleryImages.createdAt), desc(galleryImages.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const images = hasMore ? rows.slice(0, limit) : rows;
      const last = images.at(-1);
      const nextCursor = hasMore && last ? `${last.createdAt.toISOString()},${last.id}` : null;

      return { images, nextCursor };
    },
    ["gallery-images", galleryId, organizationId, String(opts.groupId), opts.cursor ?? "", String(opts.limit ?? "")],
    { tags: [`gallery-images:${galleryId}`], revalidate: 300 },
  )();
}
