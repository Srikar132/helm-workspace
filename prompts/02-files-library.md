# Files — an organized document store, the albums counterpart

**Date:** 2026-09-16
**Branch:** `feature/draw-mode`
**Status:** draft

## Goal

Documents currently exist only as one-file-per-card drops on the canvas. Photos have somewhere to live — an album, with folders, a full-page grid, bulk actions and a canvas preview card. Give documents the same: a **Files library**, created from a canvas widget, opened as its own page, holding PDFs and Word files in folders.

Done means: adding "Files" to the canvas creates a named library; its card shows what's inside; clicking through opens a page where documents are uploaded, foldered, renamed, moved, bulk-deleted, and read — and the canvas card reflects it.

## What I read

- `AGENTS.md`, `CLAUDE.md`, `.claude/context/progress-tracker.md`, `prompts/01-document-widget.md`
- `lib/actions/albums.ts` (457 lines) — the whole shape being mirrored: `getOwnedAlbum` org-scoping in front of every mutation, `unstable_cache` + `revalidateTag` per album/group/image, cursor pagination on `"createdAt,id"`, `getAlbumPreviewsByIds` batched for the canvas, Cloudinary cleanup enqueued on every delete path.
- `components/albums/*` — `album-view.tsx` (584: sidebar of groups, infinite grid, selection mode), `photo-grid.tsx` (334), `lightbox.tsx` (230), `bulk-action-bar.tsx` (104), `use-album-upload.ts` (84, per-file progress tiles), `use-album-image-mutations.ts` (85, the six shared write paths), `upload-dropzone.tsx` (36).
- `components/canvas/gallery-widget.tsx` (287) — draft-form → preview-card widget, `["albumPreview", id]` query, server-prefetched `initialPreview`.
- `app/workspace/[slug]/albums/[albumId]/page.tsx` — auth, org switch, server-side first page.
- `app/workspace/[slug]/page.tsx` — batched preview prefetch feeding `WidgetNodeContext`.
- `lib/canvas/document-file.ts`, `components/canvas/document-widget.tsx`, `components/canvas/document-viewer-overlay.tsx` — what already exists and gets reused rather than rewritten.

## Decisions and assumptions

- **Decision (user's, asked): documents only.** PDF and Word. Photos stay in albums; no type is storable in two places. Enforced by `classifyDocumentFile` on the upload path, the same gate the document widget uses.
- **Decision (user's, asked): it is called "Files"**, at `/workspace/[slug]/files/[libraryId]`. `docs` already means Tiptap project documentation; naming this "Documents" would put two unrelated things under the same word.
- **Decision: mirror albums' architecture rather than invent one.** Three tables (library / folder / file), the same ownership-check-then-mutate shape, the same cache tags, the same cursor pagination, the same widget-preview prefetch. A second organizing surface that works differently from the first is a surface people have to learn twice.
- **Decision: reuse what the document widget already built** — `classifyDocumentFile`, `formatFileSize`, `pdfThumbnailUrl`, `DOCUMENT_ACCEPT`, `uploadToCloudinary`, and `DocumentViewerOverlay`. The grid opens a PDF in that same overlay; nothing about the viewer is rebuilt for this page.
- **Decision: no lightbox.** An album's lightbox exists for stepping through photos; documents are opened one at a time and read in the PDF viewer. A "next document" arrow in a PDF viewer is not a thing anyone wants.
- **Decision: store `resourceType` and `kind` per file row.** `kind` drives the icon and whether the viewer or a download opens; `resourceType` records what Cloudinary actually holds, so a delete is exact rather than relying on the three-way fallback in `runCleanupJobs` (that fallback stays as the backstop).
- **Decision: the existing single-document canvas card stays.** Dropping a PDF on the canvas still makes a standalone card. A library is for material worth organizing; a dropped card is for the thing you are looking at right now. Same relationship the media widget has to albums.
- **Rejected: making the `document` widget point into a library.** It would mean a dropped file needs a library chosen before it can exist, which is exactly the friction that made the drop-a-file-on-the-canvas path worth having.
- **Rejected: drag-and-drop reordering of files.** Albums don't have it either; folders carry the organization. Folder `position` exists for sidebar ordering, as in albums.
- **Assumption: view-only members can browse, open and download** everything in a library, and can do nothing else — the same `canWriteEntries` gate albums use (not `canWriteWidgets`; albums and docs both use the entries predicate, and all three resolve to owner/admin today).
- **Assumption: 25MB per file**, carried over from `lib/upload-client.ts`.
- **Assumption: deleting a library deletes its documents**, DB rows by cascade and Cloudinary assets by cleanup job — same as deleting an album.

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `lib/db.ts` | edit — three tables: `fileLibraries`, `fileFolders`, `libraryFiles`, registered in the drizzle schema |
| `drizzle/migrations/00XX_*.sql` | new — generated, never hand-edited |
| `lib/actions/files.ts` | new — create/rename/delete library, create/rename/delete folder, add/rename/delete/move/bulk-move/bulk-delete file, `getFileLibrary`, `getFileFolders`, `getLibraryFiles` (cursor-paginated), `getFileLibraryPreview`, `getFileLibraryPreviewsByIds` |
| `app/workspace/[slug]/files/[libraryId]/page.tsx` | new — auth, org switch, server-side folders + first page |
| `components/files/library-view.tsx` | new — folder sidebar, infinite grid, selection mode, rename/delete library |
| `components/files/file-grid.tsx` | new — document tiles (PDF thumbnail via `pdfThumbnailUrl`, Word icon), per-tile menu, upload placeholders |
| `components/files/upload-dropzone.tsx` | new — click-or-drop, `DOCUMENT_ACCEPT` |
| `components/files/bulk-action-bar.tsx` | new — bulk move/delete for selected files |
| `components/files/use-file-upload.ts` | new — direct Cloudinary upload with per-file progress, then attach |
| `components/files/use-file-mutations.ts` | new — the shared write paths (rename/delete/move/bulk) |
| `components/canvas/files-widget.tsx` | new — draft name form → preview card → OPEN FILES link |
| `components/canvas/widget-registry.ts` | edit — register `files`, defaults, title, content-height, `initialLibraryPreviews` on `WidgetNodeContext`, wired in `buildNode` |
| `components/canvas/widget-node.tsx` | edit — dispatch case + `initialLibraryPreview` on `WidgetNodeData` |
| `components/canvas/widget-toolbar.tsx` | edit — "Files" entry |
| `components/canvas/canvas-shell.tsx` | edit — thread `initialLibraryPreviews` through |
| `app/workspace/[slug]/page.tsx` | edit — batched `getFileLibraryPreviewsByIds` prefetch |
| `lib/query-keys.ts` | edit — only if a key here turns out not to be id-scoped (it should be; ids are globally unique) |
| `tests/files-library.test.ts` | new — cursor encode/decode, upload type gate, preview shaping |

## Requirements

1. "Files" appears in the canvas toolbar. Adding it creates a card asking for a name; submitting creates the library and the card becomes its preview.
2. The preview card shows the library name, how many documents it holds, and a few of the most recent ones, plus a link through to the library page. It refreshes after changes made on that page.
3. The library page lists folders in a sidebar — All documents, Ungrouped, then each folder — with counts, and create/rename/delete for folders.
4. Deleting a folder keeps its documents, moving them to Ungrouped.
5. Documents upload by dropping anywhere on the page or through a picker, several at once, each showing its own progress tile that becomes the real tile when it lands.
6. Only PDF and Word files are accepted; anything else is refused per file with a toast naming what is accepted, and the rest of the batch still uploads.
7. A PDF tile shows its first page; a Word tile shows a file-type icon. Every tile shows name and size.
8. Clicking a PDF opens it in the existing viewer overlay; clicking a Word file downloads it.
9. A tile's menu offers Open/Download, Rename, Move to folder, and Delete.
10. Selection mode allows selecting many tiles and moving or deleting them in one action.
11. The grid pages in as it scrolls rather than loading a whole library at once, filtered by the selected folder.
12. Deleting a document, a folder's documents, or a whole library enqueues Cloudinary cleanup for every asset involved.
13. A view-only member sees the library, opens and downloads documents, and gets no upload target, no menus, no selection mode.
14. Everything is scoped to the workspace: a library id from another workspace is indistinguishable from one that does not exist.

## Data and schema

New, additive — no existing table changes.

```
file_libraries   id, organization_id → organization (cascade), name, created_by → user (set null),
                 created_at, updated_at                        idx: (organization_id)

file_folders     id, library_id → file_libraries (cascade), name, position, created_at
                                                              idx: (library_id)

library_files    id, library_id → file_libraries (cascade), folder_id → file_folders (set null),
                 url, cloudinary_public_id, resource_type, kind, name, bytes,
                 created_by → user (set null), created_at
                 idx: (library_id, created_at), (library_id, folder_id)
```

`folder_id` is nullable — null means Ungrouped, and a deleted folder sets its files back to null rather than deleting them (albums' exact rule).

Applied with `npx drizzle-kit generate` then `npm run db:migrate`. **Note:** `drizzle.config.ts` reads `.env.local`, and this machine has the values in `.env` — so the migrate step needs `DATABASE_URL` supplied from `.env` for the command to connect. It writes three new tables to the Neon database and touches no existing one.

## Security

- Every action calls `requireViewerContext()` then an ownership check (`getOwnedLibrary(id, organizationId)`) before touching a row — the direct mirror of `getOwnedAlbum`. Bulk actions re-check ownership of every affected library before writing, as `bulkMoveImagesAction` does.
- Writes gate on `canWriteEntries(viewer.role)`; reads are workspace-scoped and available to any member.
- The page authenticates the session, resolves the workspace by slug, switches the active organization if needed, and 404s an id that is not this workspace's.
- Uploads keep going through the existing signed route — no file bytes through our server, signature scoped to `helm-canvas/${organizationId}`, `checkRateLimit` per issuance. No new secret, nothing new in the browser.
- Every mutation carries its own `checkRateLimit` identifier (`create-library:`, `upload-file:`, `delete-file:`, …) so a burst on one cannot lock out another.
- Nothing here is publicly shareable; unlike a doc project there is no share token and no unauthenticated route.

## Client data flow

- `useInfiniteQuery` on `["libraryFiles", libraryId, filter]` for the grid; `useQuery` on `["fileLibraryPreview", libraryId]` for the canvas card, seeded from the server-prefetched preview.
- Every write is a `useMutation` wrapped in `unwrapAction`, and each invalidates `["libraryFiles", libraryId]` **and** `["fileLibraryPreview", libraryId]` — the canvas card caches a preview of exactly this data, which is the case `CLAUDE.md` calls out by name.
- Keys are id-scoped, so they need nothing from `lib/query-keys.ts` (ids identify the workspace implicitly, same as albums and doc projects).
- Server-side reads use `unstable_cache` with `library:`, `library-folders:`, `library-files:` tags, revalidated by tag on every write — the albums pattern.

## Acceptance criteria

- [ ] Every requirement above, observable in the running app.
- [ ] A change made on the library page is visible on the canvas card without a reload.
- [ ] Rejected file types do not abort the rest of a multi-file drop.
- [ ] Deleting a library leaves a `cloudinary_cleanup_jobs` row per document it held.
- [ ] A view-only member has no write affordance anywhere on the page.

## Checks

- [ ] `npx drizzle-kit generate` + `npm run db:migrate`
- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run`
- [ ] `timeout 150 npx next build`

## Manual test steps

`npm run dev` (port 3001), signed in as owner/admin.

1. Canvas → toolbar → Files → name it "Specs" → card becomes a preview showing "0 documents".
2. Click through to the library page. Drop three PDFs and a `.docx` at once → four progress tiles → four real tiles, PDFs showing page 1.
3. Drop a `.png` → refused with a toast; anything else in that drop still uploads.
4. Create a folder "Archive", move two documents into it, check the sidebar counts.
5. Delete the folder → its documents reappear under Ungrouped, not deleted.
6. Select three tiles → bulk delete. Check `cloudinary_cleanup_jobs` in `npm run db:studio` for three pending rows.
7. Click a PDF → viewer overlay. Click a Word file → downloads.
8. Rename a document, rename the library.
9. Back to the canvas → the card shows the new library name and the right count, without a reload.
10. Scroll a library with 60+ documents → later pages load as you reach them.
11. Open the same library as an invited view-only member → browse, open, download; no dropzone, no menus, no selection.

## Follow-ups

- Search across a library (name match) — obvious next step, deliberately not in this pass.
- Moving a document between libraries (albums have no cross-album move either).
- PPTX/XLSX would be one entry in `classifyDocumentFile` plus an icon, if the answer to "documents only" ever widens.
- Word thumbnails still need Cloudinary's paid conversion add-on; the icon tile stands in.
