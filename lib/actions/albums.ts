"use server";

import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, albums, albumGroups, albumImages } from "@/lib/db";
import { requireViewerContext } from "@/lib/workspace";
import { canWriteEntries } from "@/lib/permissions";
import { enqueueCloudinaryCleanup, runCleanupJobs } from "@/lib/cloudinary-cleanup";
import { checkRateLimit } from "@/lib/rate-limit";

export type ActionState = { error?: string };

export type AlbumRow = typeof albums.$inferSelect;
export type AlbumGroupRow = typeof albumGroups.$inferSelect;
export type AlbumImageRow = typeof albumImages.$inferSelect;

/** An album holds photos AND documents (see lib/album-file.ts) — `images`
 *  keeps its name here because the table and every query below still do. */
export type AlbumPreview = { name: string; count: number; images: AlbumImageRow[] };

/** Scopes an album lookup by the caller's org — the actual thing stopping
 *  one workspace from touching another's album by guessing an id. Every
 *  mutation below calls this first, mirroring docs.ts's getDocProject
 *  ownership-check pattern. */
async function getOwnedAlbum(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: albums.id, name: albums.name })
    .from(albums)
    .where(and(eq(albums.id, id), eq(albums.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

const nameSchema = z.string().trim().min(1, "Name is required.").max(120, "Keep it under 120 characters.");

export async function createAlbumAction(name: string): Promise<{ error?: string; id?: string }> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`create-album:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [album] = await db
    .insert(albums)
    .values({ organizationId: viewer.organizationId, name: parsed.data, createdBy: viewer.userId })
    .returning({ id: albums.id });

  if (!album) return { error: "Could not create the album. Please try again." };

  return { id: album.id };
}

export async function renameAlbumAction(id: string, name: string): Promise<ActionState> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`rename-album:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedAlbum(id, viewer.organizationId);
  if (!owned) return { error: "Album not found." };

  await db.update(albums).set({ name: parsed.data, updatedAt: new Date() }).where(eq(albums.id, id));
  revalidateTag(`album:${id}`, { expire: 0 });
  return {};
}

export async function deleteAlbumAction(id: string): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`delete-album:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedAlbum(id, viewer.organizationId);
  if (!owned) return { error: "Album not found." };

  const images = await db
    .select({ cloudinaryPublicId: albumImages.cloudinaryPublicId })
    .from(albumImages)
    .where(eq(albumImages.albumId, id));

  await db.delete(albums).where(eq(albums.id, id));
  revalidateTag(`album:${id}`, { expire: 0 });
  revalidateTag(`album-groups:${id}`, { expire: 0 });
  revalidateTag(`album-images:${id}`, { expire: 0 });

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

export async function getAlbumsForWorkspace(): Promise<AlbumRow[]> {
  const viewer = await requireViewerContext();
  return db.select().from(albums).where(eq(albums.organizationId, viewer.organizationId));
}

export async function getAlbum(id: string): Promise<AlbumRow | null> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const [row] = await db
        .select()
        .from(albums)
        .where(and(eq(albums.id, id), eq(albums.organizationId, organizationId)))
        .limit(1);
      return row ?? null;
    },
    ["album", id, organizationId],
    { tags: [`album:${id}`], revalidate: 300 },
  )();
}

/** Batched lookup for the canvas — one round trip for every gallery widget's
 *  preview instead of one query per widget. Mirrors getDocProjectsByIds. */
export async function getAlbumPreviewsByIds(ids: string[]): Promise<Record<string, AlbumPreview>> {
  if (ids.length === 0) return {};
  const viewer = await requireViewerContext();

  const owned = await db
    .select({ id: albums.id })
    .from(albums)
    .where(and(inArray(albums.id, ids), eq(albums.organizationId, viewer.organizationId)));
  const ownedIds = owned.map((a) => a.id);
  if (ownedIds.length === 0) return {};

  const previews = await Promise.all(ownedIds.map((id) => getAlbumPreview(id)));
  return Object.fromEntries(ownedIds.map((id, i) => [id, previews[i]]));
}

/** The query backing the canvas fan card — cheap and constant-size
 *  regardless of how many images the album actually has. */
export async function getAlbumPreview(albumId: string): Promise<AlbumPreview> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedAlbum(albumId, organizationId);
      if (!owned) return { name: "", count: 0, images: [] };

      const [images, [{ count }]] = await Promise.all([
        db
          .select()
          .from(albumImages)
          .where(eq(albumImages.albumId, albumId))
          .orderBy(desc(albumImages.createdAt))
          .limit(3),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(albumImages)
          .where(eq(albumImages.albumId, albumId)),
      ]);

      return { name: owned.name, count, images };
    },
    ["album-preview", albumId, organizationId],
    { tags: [`album:${albumId}`], revalidate: 300 },
  )();
}

export async function getAlbumGroups(albumId: string): Promise<AlbumGroupRow[]> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedAlbum(albumId, organizationId);
      if (!owned) return [];
      return db.select().from(albumGroups).where(eq(albumGroups.albumId, albumId)).orderBy(asc(albumGroups.position));
    },
    ["album-groups", albumId, organizationId],
    { tags: [`album-groups:${albumId}`], revalidate: 300 },
  )();
}

export async function createAlbumGroup(albumId: string, name: string): Promise<{ error?: string; id?: string }> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`create-album-group:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedAlbum(albumId, viewer.organizationId);
  if (!owned) return { error: "Album not found." };

  const existing = await db
    .select({ position: albumGroups.position })
    .from(albumGroups)
    .where(eq(albumGroups.albumId, albumId));
  const nextPosition = existing.length ? Math.max(...existing.map((g) => g.position)) + 1 : 0;

  const [group] = await db
    .insert(albumGroups)
    .values({ albumId, name: parsed.data, position: nextPosition })
    .returning({ id: albumGroups.id });

  revalidateTag(`album-groups:${albumId}`, { expire: 0 });
  return { id: group?.id };
}

export async function renameAlbumGroup(id: string, albumId: string, name: string): Promise<ActionState> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`rename-album-group:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedAlbum(albumId, viewer.organizationId);
  if (!owned) return { error: "Album not found." };

  await db.update(albumGroups).set({ name: parsed.data }).where(and(eq(albumGroups.id, id), eq(albumGroups.albumId, albumId)));
  revalidateTag(`album-groups:${albumId}`, { expire: 0 });
  return {};
}

export async function deleteAlbumGroup(id: string, albumId: string): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`delete-album-group:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedAlbum(albumId, viewer.organizationId);
  if (!owned) return { error: "Album not found." };

  // Images in this group fall back to ungrouped via the FK's
  // onDelete: "set null" — deleting a group never deletes photos.
  await db.delete(albumGroups).where(and(eq(albumGroups.id, id), eq(albumGroups.albumId, albumId)));
  revalidateTag(`album-groups:${albumId}`, { expire: 0 });
  revalidateTag(`album-images:${albumId}`, { expire: 0 });
  return {};
}

const addItemSchema = z.object({
  albumId: z.string().uuid(),
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

export async function addItemToAlbum(
  input: z.input<typeof addItemSchema>,
): Promise<{ error?: string; id?: string }> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid file." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`add-image:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedAlbum(parsed.data.albumId, viewer.organizationId);
  if (!owned) return { error: "Album not found." };

  const [image] = await db
    .insert(albumImages)
    .values({
      albumId: parsed.data.albumId,
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
    .returning({ id: albumImages.id });

  revalidateTag(`album-images:${parsed.data.albumId}`, { expire: 0 });
  revalidateTag(`album:${parsed.data.albumId}`, { expire: 0 });
  return { id: image?.id };
}

/** Every image mutation below re-derives the owning album from the image
 *  row itself, then checks that album against the caller's org — same
 *  "look up the parent, then verify" shape as docs.ts's updateDocPage. */
async function getOwnedImageAlbumId(imageId: string, organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ albumId: albumImages.albumId })
    .from(albumImages)
    .where(eq(albumImages.id, imageId))
    .limit(1);
  if (!row) return null;
  const owned = await getOwnedAlbum(row.albumId, organizationId);
  return owned ? row.albumId : null;
}

export async function renameImageAction(id: string, name: string): Promise<ActionState> {
  const parsed = z.string().trim().max(200).safeParse(name);
  if (!parsed.success) return { error: "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`rename-image:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const albumId = await getOwnedImageAlbumId(id, viewer.organizationId);
  if (!albumId) return { error: "Image not found." };

  await db.update(albumImages).set({ name: parsed.data || null }).where(eq(albumImages.id, id));
  revalidateTag(`album-images:${albumId}`, { expire: 0 });
  return {};
}

export async function deleteImageAction(id: string): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`delete-image:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [row] = await db
    .select({ albumId: albumImages.albumId, cloudinaryPublicId: albumImages.cloudinaryPublicId })
    .from(albumImages)
    .where(eq(albumImages.id, id))
    .limit(1);
  if (!row) return { error: "Image not found." };
  const owned = await getOwnedAlbum(row.albumId, viewer.organizationId);
  if (!owned) return { error: "Image not found." };

  await db.delete(albumImages).where(eq(albumImages.id, id));
  revalidateTag(`album-images:${row.albumId}`, { expire: 0 });
  revalidateTag(`album:${row.albumId}`, { expire: 0 });

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

  const albumId = await getOwnedImageAlbumId(id, viewer.organizationId);
  if (!albumId) return { error: "Image not found." };

  await db.update(albumImages).set({ groupId }).where(eq(albumImages.id, id));
  revalidateTag(`album-images:${albumId}`, { expire: 0 });
  return {};
}

export async function copyImageAction(id: string, targetGroupId?: string | null): Promise<{ error?: string; id?: string }> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  const rateLimit = await checkRateLimit(`copy-image:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [row] = await db.select().from(albumImages).where(eq(albumImages.id, id)).limit(1);
  if (!row) return { error: "Image not found." };
  const owned = await getOwnedAlbum(row.albumId, viewer.organizationId);
  if (!owned) return { error: "Image not found." };

  // Duplicates the row pointing at the same Cloudinary URL — no re-upload.
  // Deliberately omits cloudinaryPublicId so deleting either copy never
  // destroys the other's underlying asset.
  const [copy] = await db
    .insert(albumImages)
    .values({
      albumId: row.albumId,
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
    .returning({ id: albumImages.id });

  revalidateTag(`album-images:${row.albumId}`, { expire: 0 });
  revalidateTag(`album:${row.albumId}`, { expire: 0 });
  return { id: copy?.id };
}

export async function bulkDeleteImagesAction(ids: string[]): Promise<ActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: "View-only access." };
  if (ids.length === 0) return {};
  const rateLimit = await checkRateLimit(`bulk-delete-images:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const rows = await db
    .select({ id: albumImages.id, albumId: albumImages.albumId, cloudinaryPublicId: albumImages.cloudinaryPublicId })
    .from(albumImages)
    .where(inArray(albumImages.id, ids));

  const albumIds = [...new Set(rows.map((r) => r.albumId))];
  const ownedAlbums = await db
    .select({ id: albums.id })
    .from(albums)
    .where(and(inArray(albums.id, albumIds), eq(albums.organizationId, viewer.organizationId)));
  const ownedSet = new Set(ownedAlbums.map((a) => a.id));
  const deletable = rows.filter((r) => ownedSet.has(r.albumId));
  if (deletable.length === 0) return {};

  await db.delete(albumImages).where(inArray(albumImages.id, deletable.map((r) => r.id)));
  for (const affectedAlbumId of new Set(deletable.map((r) => r.albumId))) {
    revalidateTag(`album-images:${affectedAlbumId}`, { expire: 0 });
    revalidateTag(`album:${affectedAlbumId}`, { expire: 0 });
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

  const rows = await db.select({ id: albumImages.id, albumId: albumImages.albumId }).from(albumImages).where(inArray(albumImages.id, ids));
  const albumIds = [...new Set(rows.map((r) => r.albumId))];
  const ownedAlbums = await db
    .select({ id: albums.id })
    .from(albums)
    .where(and(inArray(albums.id, albumIds), eq(albums.organizationId, viewer.organizationId)));
  const ownedSet = new Set(ownedAlbums.map((a) => a.id));
  const movableRows = rows.filter((r) => ownedSet.has(r.albumId));
  if (movableRows.length === 0) return {};

  await db.update(albumImages).set({ groupId }).where(inArray(albumImages.id, movableRows.map((r) => r.id)));
  for (const affectedAlbumId of new Set(movableRows.map((r) => r.albumId))) {
    revalidateTag(`album-images:${affectedAlbumId}`, { expire: 0 });
  }
  return {};
}

export type AlbumImagesPage = { images: AlbumImageRow[]; nextCursor: string | null };

/** Cursor-paginated so a huge album never loads in one shot — cursor is
 *  "createdAt,id" (id as a tiebreaker for same-millisecond uploads). */
export async function getAlbumImages(
  albumId: string,
  opts: { groupId?: string | null; cursor?: string | null; limit?: number } = {},
): Promise<AlbumImagesPage> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedAlbum(albumId, organizationId);
      if (!owned) return { images: [], nextCursor: null };

      const limit = Math.min(opts.limit ?? 60, 120);
      const conditions = [eq(albumImages.albumId, albumId)];
      if (opts.groupId === null) conditions.push(sql`${albumImages.groupId} is null`);
      else if (opts.groupId) conditions.push(eq(albumImages.groupId, opts.groupId));

      if (opts.cursor) {
        const [cursorCreatedAt, cursorId] = opts.cursor.split(",");
        if (cursorCreatedAt && cursorId) {
          conditions.push(
            or(
              lt(albumImages.createdAt, new Date(cursorCreatedAt)),
              and(eq(albumImages.createdAt, new Date(cursorCreatedAt)), lt(albumImages.id, cursorId)),
            )!,
          );
        }
      }

      const rows = await db
        .select()
        .from(albumImages)
        .where(and(...conditions))
        .orderBy(desc(albumImages.createdAt), desc(albumImages.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const images = hasMore ? rows.slice(0, limit) : rows;
      const last = images.at(-1);
      const nextCursor = hasMore && last ? `${last.createdAt.toISOString()},${last.id}` : null;

      return { images, nextCursor };
    },
    ["album-images", albumId, organizationId, String(opts.groupId), opts.cursor ?? "", String(opts.limit ?? "")],
    { tags: [`album-images:${albumId}`], revalidate: 300 },
  )();
}
