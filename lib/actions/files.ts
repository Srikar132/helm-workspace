"use server";

import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import { and, asc, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, fileLibraries, fileFolders, libraryFiles } from "@/lib/db";
import { requireViewerContext } from "@/lib/workspace";
import { canWriteEntries } from "@/lib/permissions";
import { enqueueCloudinaryCleanup, runCleanupJobs } from "@/lib/cloudinary-cleanup";
import { checkRateLimit } from "@/lib/rate-limit";

export type FileActionState = { error?: string };

export type FileLibraryRow = typeof fileLibraries.$inferSelect;
export type FileFolderRow = typeof fileFolders.$inferSelect;
export type LibraryFileRow = typeof libraryFiles.$inferSelect;

export type FileLibraryPreview = { name: string; count: number; files: LibraryFileRow[] };

const READ_ONLY = "View-only access.";
const NOT_FOUND = "Library not found.";

/** Scopes a library lookup by the caller's org — the thing that actually stops
 *  one workspace reaching another's library by guessing an id. Every mutation
 *  below calls this first, mirroring albums.ts's getOwnedAlbum. */
async function getOwnedLibrary(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: fileLibraries.id, name: fileLibraries.name })
    .from(fileLibraries)
    .where(and(eq(fileLibraries.id, id), eq(fileLibraries.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** The library a folder belongs to, but only if the caller's org owns it. */
async function getOwnedFolderLibraryId(folderId: string, organizationId: string) {
  const [row] = await db
    .select({ libraryId: fileFolders.libraryId })
    .from(fileFolders)
    .where(eq(fileFolders.id, folderId))
    .limit(1);
  if (!row) return null;
  const owned = await getOwnedLibrary(row.libraryId, organizationId);
  return owned ? row.libraryId : null;
}

/** Same, for one document. */
async function getOwnedFileLibraryId(fileId: string, organizationId: string) {
  const [row] = await db
    .select({ libraryId: libraryFiles.libraryId })
    .from(libraryFiles)
    .where(eq(libraryFiles.id, fileId))
    .limit(1);
  if (!row) return null;
  const owned = await getOwnedLibrary(row.libraryId, organizationId);
  return owned ? row.libraryId : null;
}

function revalidateLibrary(libraryId: string) {
  revalidateTag(`library:${libraryId}`, { expire: 0 });
  revalidateTag(`library-files:${libraryId}`, { expire: 0 });
}

const nameSchema = z.string().trim().min(1, "Name is required.").max(120, "Keep it under 120 characters.");

// ---------------------------------------------------------------- libraries

export async function createFileLibraryAction(name: string): Promise<{ error?: string; id?: string }> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`create-library:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [library] = await db
    .insert(fileLibraries)
    .values({ organizationId: viewer.organizationId, name: parsed.data, createdBy: viewer.userId })
    .returning({ id: fileLibraries.id });

  if (!library) return { error: "Could not create the library. Please try again." };
  return { id: library.id };
}

export async function renameFileLibraryAction(id: string, name: string): Promise<FileActionState> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`rename-library:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedLibrary(id, viewer.organizationId);
  if (!owned) return { error: NOT_FOUND };

  await db.update(fileLibraries).set({ name: parsed.data, updatedAt: new Date() }).where(eq(fileLibraries.id, id));
  revalidateTag(`library:${id}`, { expire: 0 });
  return {};
}

export async function deleteFileLibraryAction(id: string): Promise<FileActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`delete-library:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedLibrary(id, viewer.organizationId);
  if (!owned) return { error: NOT_FOUND };

  const docs = await db
    .select({ cloudinaryPublicId: libraryFiles.cloudinaryPublicId })
    .from(libraryFiles)
    .where(eq(libraryFiles.libraryId, id));

  await db.delete(fileLibraries).where(eq(fileLibraries.id, id));
  revalidateLibrary(id);
  revalidateTag(`library-folders:${id}`, { expire: 0 });

  // Job rows are written NOW, before the response goes out — the after() pass
  // below is only the fast path, and the cron sweep is the guarantee.
  const publicIds = docs.map((d) => d.cloudinaryPublicId).filter((v): v is string => !!v);
  if (publicIds.length > 0) {
    const jobs = await enqueueCloudinaryCleanup(publicIds);
    after(() => runCleanupJobs(jobs));
  }

  return {};
}

export async function getFileLibrariesForWorkspace(): Promise<FileLibraryRow[]> {
  const viewer = await requireViewerContext();
  return db.select().from(fileLibraries).where(eq(fileLibraries.organizationId, viewer.organizationId));
}

export async function getFileLibrary(id: string): Promise<FileLibraryRow | null> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const [row] = await db
        .select()
        .from(fileLibraries)
        .where(and(eq(fileLibraries.id, id), eq(fileLibraries.organizationId, organizationId)))
        .limit(1);
      return row ?? null;
    },
    ["file-library", id, organizationId],
    { tags: [`library:${id}`], revalidate: 300 },
  )();
}

/** What a canvas card shows: the name, the total, and the few most recent
 *  documents. */
export async function getFileLibraryPreview(libraryId: string): Promise<FileLibraryPreview> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedLibrary(libraryId, organizationId);
      if (!owned) return { name: "", count: 0, files: [] };

      const [{ value: total }] = await db
        .select({ value: count() })
        .from(libraryFiles)
        .where(eq(libraryFiles.libraryId, libraryId));

      const files = await db
        .select()
        .from(libraryFiles)
        .where(eq(libraryFiles.libraryId, libraryId))
        .orderBy(desc(libraryFiles.createdAt), desc(libraryFiles.id))
        .limit(4);

      return { name: owned.name, count: total, files };
    },
    ["file-library-preview", libraryId, organizationId],
    { tags: [`library:${libraryId}`, `library-files:${libraryId}`], revalidate: 300 },
  )();
}

/** Batched lookup for the canvas — one pass for every Files widget's preview
 *  instead of one query per widget. Mirrors getAlbumPreviewsByIds. */
export async function getFileLibraryPreviewsByIds(ids: string[]): Promise<Record<string, FileLibraryPreview>> {
  if (ids.length === 0) return {};
  const viewer = await requireViewerContext();

  const owned = await db
    .select({ id: fileLibraries.id })
    .from(fileLibraries)
    .where(and(inArray(fileLibraries.id, ids), eq(fileLibraries.organizationId, viewer.organizationId)));
  const ownedIds = owned.map((l) => l.id);
  if (ownedIds.length === 0) return {};

  const previews = await Promise.all(ownedIds.map((id) => getFileLibraryPreview(id)));
  return Object.fromEntries(ownedIds.map((id, i) => [id, previews[i]]));
}

// ------------------------------------------------------------------ folders

export async function getFileFolders(libraryId: string): Promise<FileFolderRow[]> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedLibrary(libraryId, organizationId);
      if (!owned) return [];
      return db
        .select()
        .from(fileFolders)
        .where(eq(fileFolders.libraryId, libraryId))
        .orderBy(asc(fileFolders.position), asc(fileFolders.createdAt));
    },
    ["file-folders", libraryId, organizationId],
    { tags: [`library-folders:${libraryId}`], revalidate: 300 },
  )();
}

export async function createFileFolder(libraryId: string, name: string): Promise<{ error?: string; id?: string }> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`create-folder:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedLibrary(libraryId, viewer.organizationId);
  if (!owned) return { error: NOT_FOUND };

  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(fileFolders)
    .where(eq(fileFolders.libraryId, libraryId));

  const [folder] = await db
    .insert(fileFolders)
    .values({ libraryId, name: parsed.data, position: existing })
    .returning({ id: fileFolders.id });

  revalidateTag(`library-folders:${libraryId}`, { expire: 0 });
  return { id: folder?.id };
}

export async function renameFileFolder(id: string, libraryId: string, name: string): Promise<FileActionState> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`rename-folder:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const ownedLibraryId = await getOwnedFolderLibraryId(id, viewer.organizationId);
  if (!ownedLibraryId || ownedLibraryId !== libraryId) return { error: "Folder not found." };

  await db.update(fileFolders).set({ name: parsed.data }).where(eq(fileFolders.id, id));
  revalidateTag(`library-folders:${libraryId}`, { expire: 0 });
  return {};
}

/** Deleting a folder keeps its documents — the FK is ON DELETE SET NULL, so
 *  they fall back to ungrouped rather than being destroyed along with it. */
export async function deleteFileFolder(id: string, libraryId: string): Promise<FileActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`delete-folder:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const ownedLibraryId = await getOwnedFolderLibraryId(id, viewer.organizationId);
  if (!ownedLibraryId || ownedLibraryId !== libraryId) return { error: "Folder not found." };

  await db.delete(fileFolders).where(eq(fileFolders.id, id));
  revalidateTag(`library-folders:${libraryId}`, { expire: 0 });
  revalidateTag(`library-files:${libraryId}`, { expire: 0 });
  return {};
}

// ---------------------------------------------------------------- documents

const addFileSchema = z.object({
  libraryId: z.string().uuid(),
  folderId: z.string().uuid().optional(),
  url: z.string().url(),
  cloudinaryPublicId: z.string().optional(),
  resourceType: z.enum(["image", "raw"]),
  kind: z.enum(["pdf", "word"]),
  name: z.string().trim().min(1).max(300),
  bytes: z.number().int().nonnegative(),
});

/** Called after the browser's direct-to-Cloudinary upload finishes — this
 *  records the result, it never sees the file itself. */
export async function addFileToLibrary(input: z.infer<typeof addFileSchema>): Promise<{ error?: string; id?: string }> {
  const parsed = addFileSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid document." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`add-file:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const owned = await getOwnedLibrary(parsed.data.libraryId, viewer.organizationId);
  if (!owned) return { error: NOT_FOUND };

  if (parsed.data.folderId) {
    const folderLibraryId = await getOwnedFolderLibraryId(parsed.data.folderId, viewer.organizationId);
    if (folderLibraryId !== parsed.data.libraryId) return { error: "Folder not found." };
  }

  const [row] = await db
    .insert(libraryFiles)
    .values({
      libraryId: parsed.data.libraryId,
      folderId: parsed.data.folderId ?? null,
      url: parsed.data.url,
      cloudinaryPublicId: parsed.data.cloudinaryPublicId ?? null,
      resourceType: parsed.data.resourceType,
      kind: parsed.data.kind,
      name: parsed.data.name,
      bytes: parsed.data.bytes,
      createdBy: viewer.userId,
    })
    .returning({ id: libraryFiles.id });

  revalidateLibrary(parsed.data.libraryId);
  return { id: row?.id };
}

export async function renameLibraryFileAction(id: string, name: string): Promise<FileActionState> {
  const parsed = z.string().trim().min(1).max(300).safeParse(name);
  if (!parsed.success) return { error: "Invalid name." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`rename-file:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const libraryId = await getOwnedFileLibraryId(id, viewer.organizationId);
  if (!libraryId) return { error: "Document not found." };

  await db.update(libraryFiles).set({ name: parsed.data }).where(eq(libraryFiles.id, id));
  revalidateTag(`library-files:${libraryId}`, { expire: 0 });
  return {};
}

export async function deleteLibraryFileAction(id: string): Promise<FileActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`delete-file:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [row] = await db
    .select({ libraryId: libraryFiles.libraryId, cloudinaryPublicId: libraryFiles.cloudinaryPublicId })
    .from(libraryFiles)
    .where(eq(libraryFiles.id, id))
    .limit(1);
  if (!row) return { error: "Document not found." };
  const owned = await getOwnedLibrary(row.libraryId, viewer.organizationId);
  if (!owned) return { error: "Document not found." };

  await db.delete(libraryFiles).where(eq(libraryFiles.id, id));
  revalidateLibrary(row.libraryId);

  if (row.cloudinaryPublicId) {
    const jobs = await enqueueCloudinaryCleanup([row.cloudinaryPublicId]);
    after(() => runCleanupJobs(jobs));
  }

  return {};
}

export async function moveLibraryFileAction(id: string, folderId: string | null): Promise<FileActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`move-file:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const libraryId = await getOwnedFileLibraryId(id, viewer.organizationId);
  if (!libraryId) return { error: "Document not found." };

  // A folder from a different library would quietly orphan the document from
  // every view it appears in.
  if (folderId) {
    const folderLibraryId = await getOwnedFolderLibraryId(folderId, viewer.organizationId);
    if (folderLibraryId !== libraryId) return { error: "Folder not found." };
  }

  await db.update(libraryFiles).set({ folderId }).where(eq(libraryFiles.id, id));
  revalidateTag(`library-files:${libraryId}`, { expire: 0 });
  return {};
}

const idsSchema = z.array(z.string().uuid()).min(1).max(200);

/** Every bulk path re-checks ownership of each affected library before
 *  writing, rather than trusting the id list it was handed. */
async function ownedFileRows(ids: string[], organizationId: string) {
  const rows = await db
    .select({
      id: libraryFiles.id,
      libraryId: libraryFiles.libraryId,
      cloudinaryPublicId: libraryFiles.cloudinaryPublicId,
    })
    .from(libraryFiles)
    .where(inArray(libraryFiles.id, ids));
  if (rows.length === 0) return [];

  const libraryIds = [...new Set(rows.map((r) => r.libraryId))];
  const owned = await db
    .select({ id: fileLibraries.id })
    .from(fileLibraries)
    .where(and(inArray(fileLibraries.id, libraryIds), eq(fileLibraries.organizationId, organizationId)));
  const ownedSet = new Set(owned.map((l) => l.id));

  return rows.filter((r) => ownedSet.has(r.libraryId));
}

export async function bulkDeleteLibraryFilesAction(ids: string[]): Promise<FileActionState> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { error: "Nothing selected." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`bulk-delete-files:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const rows = await ownedFileRows(parsed.data, viewer.organizationId);
  if (rows.length === 0) return {};

  await db.delete(libraryFiles).where(
    inArray(
      libraryFiles.id,
      rows.map((r) => r.id),
    ),
  );
  for (const libraryId of new Set(rows.map((r) => r.libraryId))) revalidateLibrary(libraryId);

  const publicIds = rows.map((r) => r.cloudinaryPublicId).filter((v): v is string => !!v);
  if (publicIds.length > 0) {
    const jobs = await enqueueCloudinaryCleanup(publicIds);
    after(() => runCleanupJobs(jobs));
  }

  return {};
}

export async function bulkMoveLibraryFilesAction(ids: string[], folderId: string | null): Promise<FileActionState> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { error: "Nothing selected." };

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) return { error: READ_ONLY };
  const rateLimit = await checkRateLimit(`bulk-move-files:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const rows = await ownedFileRows(parsed.data, viewer.organizationId);
  if (rows.length === 0) return {};

  if (folderId) {
    const folderLibraryId = await getOwnedFolderLibraryId(folderId, viewer.organizationId);
    // Moving documents from several libraries into one folder would take them
    // out of every library but that folder's own.
    if (!folderLibraryId || rows.some((r) => r.libraryId !== folderLibraryId)) {
      return { error: "Folder not found." };
    }
  }

  await db
    .update(libraryFiles)
    .set({ folderId })
    .where(
      inArray(
        libraryFiles.id,
        rows.map((r) => r.id),
      ),
    );
  for (const libraryId of new Set(rows.map((r) => r.libraryId))) {
    revalidateTag(`library-files:${libraryId}`, { expire: 0 });
  }

  return {};
}

export type LibraryFilesPage = { files: LibraryFileRow[]; nextCursor: string | null };

/** Cursor-paginated so a large library never loads in one shot — cursor is
 *  "createdAt,id" (id as the tiebreaker for same-millisecond uploads). */
export async function getLibraryFiles(
  libraryId: string,
  opts: { folderId?: string | null; cursor?: string | null; limit?: number } = {},
): Promise<LibraryFilesPage> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedLibrary(libraryId, organizationId);
      if (!owned) return { files: [], nextCursor: null };

      const limit = Math.min(opts.limit ?? 60, 120);
      const conditions = [eq(libraryFiles.libraryId, libraryId)];
      if (opts.folderId === null) conditions.push(sql`${libraryFiles.folderId} is null`);
      else if (opts.folderId) conditions.push(eq(libraryFiles.folderId, opts.folderId));

      if (opts.cursor) {
        const [cursorCreatedAt, cursorId] = opts.cursor.split(",");
        if (cursorCreatedAt && cursorId) {
          conditions.push(
            or(
              lt(libraryFiles.createdAt, new Date(cursorCreatedAt)),
              and(eq(libraryFiles.createdAt, new Date(cursorCreatedAt)), lt(libraryFiles.id, cursorId)),
            )!,
          );
        }
      }

      const rows = await db
        .select()
        .from(libraryFiles)
        .where(and(...conditions))
        .orderBy(desc(libraryFiles.createdAt), desc(libraryFiles.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const files = hasMore ? rows.slice(0, limit) : rows;
      const last = files.at(-1);
      const nextCursor = hasMore && last ? `${last.createdAt.toISOString()},${last.id}` : null;

      return { files, nextCursor };
    },
    ["library-files", libraryId, organizationId, String(opts.folderId), opts.cursor ?? "", String(opts.limit ?? "")],
    { tags: [`library-files:${libraryId}`], revalidate: 300 },
  )();
}

/** Per-folder counts for the sidebar, in one query rather than one per row. */
export async function getFileFolderCounts(libraryId: string): Promise<{ total: number; byFolder: Record<string, number>; ungrouped: number }> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const owned = await getOwnedLibrary(libraryId, organizationId);
      if (!owned) return { total: 0, byFolder: {}, ungrouped: 0 };

      const rows = await db
        .select({ folderId: libraryFiles.folderId, value: count() })
        .from(libraryFiles)
        .where(eq(libraryFiles.libraryId, libraryId))
        .groupBy(libraryFiles.folderId);

      let total = 0;
      let ungrouped = 0;
      const byFolder: Record<string, number> = {};
      for (const row of rows) {
        total += row.value;
        if (row.folderId) byFolder[row.folderId] = row.value;
        else ungrouped = row.value;
      }
      return { total, byFolder, ungrouped };
    },
    ["file-folder-counts", libraryId, organizationId],
    { tags: [`library-files:${libraryId}`, `library-folders:${libraryId}`], revalidate: 300 },
  )();
}
