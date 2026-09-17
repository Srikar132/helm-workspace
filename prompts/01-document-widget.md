# Document widget — store PDFs and DOCX on the canvas

**Date:** 2026-09-16
**Branch:** `feature/draw-mode`
**Status:** draft

## Goal

A new canvas widget type, `document`, that holds a PDF or a Word file the way the `media` widget holds an image or a video: drop/paste/pick the file, it uploads straight to Cloudinary, and the card afterwards shows the file with a preview, a name, a size, and open/download/copy-link/delete actions.

Done means: dropping a PDF on the canvas leaves a card showing that PDF's first page; clicking it opens a readable viewer; the card survives a reload; deleting it removes the Cloudinary asset too.

## What I read

- `AGENTS.md`, `CLAUDE.md`, `.claude/context/progress-tracker.md`
- `components/canvas/media-widget.tsx` — the exact lifecycle to copy: `status: "uploading" | "ready" | "error"` in the widget's own `data`, the File handed over through `getPendingFile(id)`, upload kicked off in a mount effect with `startedRef`, a `retry()` that re-reads the pending file, progress bar, context menu for copy/download/delete.
- `lib/upload-client.ts` — signed direct-to-Cloudinary XHR upload. Hard-rejects anything that is not `image/*` or `video/*` today, and picks the upload URL's resource type from that same check. 25MB cap.
- `app/api/media/upload/route.ts` — signs `{ timestamp, folder }` only, folder namespaced `helm-canvas/${organizationId}`. Resource type is not part of the signature, so the same signature works for a `raw` or `image` upload.
- `lib/cloudinary-cleanup.ts` — `enqueueCloudinaryCleanup()` + `runCleanupJobs()`, the durable delete path; `app/api/cron/cloudinary-cleanup/route.ts` sweeps.
- `lib/actions/widgets.ts` — `deleteWidgetAction` deletes the row and nothing else today.
- `components/canvas/widget-registry.ts` — every per-type behaviour switch.
- `components/canvas/widget-node.tsx` — `renderWidgetBody` dispatch, the `media` special-case for card background.
- `components/canvas/hooks/use-canvas-paste.ts` — `MEDIA_MIME_PATTERN` gates both paste and drop; non-image/video files are ignored entirely.
- `components/canvas/hooks/use-widget-actions.ts` — `addWidget`, `addMediaFiles`, the in-memory `pendingFiles` map.
- `components/canvas/widget-toolbar.tsx` — `ADDABLE_WIDGET_TYPES`.

## Decisions and assumptions

- **Decision: one new widget type `document`, not an extension of `media`.** `media` renders `<img>`/`<video>` filling a chromeless card and is a different card shape (no header, no filename, object-fit contain). A document card is icon/thumbnail + filename + size + actions. Sharing the type would mean branching on `resourceType` in every one of those places.
- **Decision: PDF uploads as Cloudinary resource type `image`; DOCX/DOC uploads as `raw`.** Cloudinary treats PDF as an image it can rasterise, which is what gives a first-page thumbnail (`f_jpg,pg_1,w_640`) for free. Word files have no such transform without the paid document-conversion add-on, so they get a file-type card instead of a thumbnail. Uploading a PDF as `raw` instead would be simpler by one branch and would cost the preview entirely.
- **Decision: the file arrives three ways** — drop on canvas, paste, and a click-to-pick dropzone inside a freshly added card (the toolbar/tap-to-add path has no file yet, so the card starts as a picker rather than the `uploading` skeleton `media` starts in). This is the same draft-then-saved shape `bookmark` and `gallery` already use.
- **Decision: delete removes the Cloudinary asset, through `deleteWidgetAction`.** The widget stores `publicId` and `resourceType`; `deleteWidgetAction` reads the row before deleting it, and if that data carries a `cloudinaryPublicId`, enqueues a cleanup job and attempts it in `after()` — the same durable pattern `lib/actions/albums.ts` uses. Doing it client-side from the widget would lose the asset whenever the tab closes first.
- **Decision: the viewer is an in-app overlay with an `<iframe>` for PDFs only.** Word documents cannot be rendered in a browser without a converter; their card offers Download and Open-in-new-tab, nothing else. Same precedent as `mail-reader-overlay.tsx` for the overlay itself.
- **Rejected: routing DOCX through `view.officeapps.live.com`** to fake an inline preview. It hands a workspace's document URL to a third party Microsoft service on every view — a data boundary this app does not otherwise cross, for a preview nobody asked for.
- **Rejected: a `documents` table.** The widget's `data` JSONB already holds everything (url, publicId, name, size, kind), exactly as `media` does. A table would only earn its place if documents needed to exist independently of a canvas card, like albums do.
- **Rejected: server-side type/size enforcement.** The signed-upload route deliberately never sees the bytes (documented at length in that route). The new type checks live client-side alongside the existing ones, with the same stated tradeoff.
- **Assumption: 25MB stays the cap**, reusing `MAX_BYTES` from `lib/upload-client.ts`. A scanned PDF can exceed that; say so and I will raise it.
- **Assumption: accepted types are `application/pdf`, `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) and legacy `.doc` (`application/msword`).** Not PPTX/XLSX — the request said PDFs and Word.
- **Assumption: view-only members cannot add documents**, same as every other widget (`canWrite` gates the dropzone and the delete item; the card and its Open/Download stay available to them).

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `lib/canvas/document-file.ts` | new — pure helpers: `classifyDocumentFile(mime, name)` → `"pdf" \| "word" \| null`, `DOCUMENT_MIME_PATTERN`, `DOCUMENT_ACCEPT`, `formatFileSize(bytes)`, `pdfThumbnailUrl(url)`, `readDocumentData(data)` |
| `lib/upload-client.ts` | edit — accept documents: widen the guard, add `resourceType: "raw"` to the result union, pick the upload path per resource type, return `bytes`/`originalFilename` |
| `components/canvas/document-widget.tsx` | new — the widget: picker → uploading → ready/error, context menu, viewer trigger |
| `components/canvas/document-viewer-overlay.tsx` | new — full-screen PDF `<iframe>` overlay with Escape/close/download |
| `components/canvas/widget-registry.ts` | edit — register `document` in `KNOWN_WIDGET_TYPES`, `MULTI_INSTANCE_WIDGET_TYPES`, `NEW_WIDGET_DEFAULTS`, `AUTO_HEIGHT_MIN`, `CONTENT_HEIGHT_TYPES`, `widgetTitle` |
| `components/canvas/widget-node.tsx` | edit — `renderWidgetBody` case |
| `components/canvas/widget-toolbar.tsx` | edit — `ADDABLE_WIDGET_TYPES` entry, `FileText` icon |
| `components/canvas/hooks/use-canvas-paste.ts` | edit — route pasted/dropped PDFs and Word files to the document type instead of ignoring them |
| `components/canvas/hooks/use-widget-actions.ts` | edit — generalise `addMediaFiles` into `addFiles`, which routes each file by mime to `media` or `document` |
| `lib/actions/widgets.ts` | edit — `deleteWidgetAction` enqueues Cloudinary cleanup when the deleted row's data carries `cloudinaryPublicId` |
| `tests/document-file.test.ts` | new — classification, size formatting, thumbnail URL building |
| `.env.example` | no change (no new keys) |

## Requirements

1. Dragging a `.pdf`, `.docx` or `.doc` onto the canvas creates a `document` widget at the drop point that immediately begins uploading, with a live progress percentage.
2. Pasting the same file types does the same thing at the pointer position. Pasting an image or video still creates a `media` widget; pasting text or a URL is unchanged.
3. Adding "Document" from the widget toolbar (tap or drag) creates a card showing a picker — an outlined drop target with a "Choose a PDF or Word file" button — which accepts both a click-to-browse pick and a file dropped onto the card itself.
4. A file of any other type is rejected before upload starts, with a toast naming what is accepted.
5. A file over 25MB is rejected before upload starts, with a toast.
6. A finished PDF card shows its first page as a thumbnail, its filename, and its size. A finished Word card shows a Word file-type icon in place of the thumbnail, plus the same filename and size.
7. Clicking a finished PDF card opens the viewer overlay showing the whole document, scrollable, with a close button and Escape to dismiss. Clicking a finished Word card triggers its download instead.
8. The card's context menu offers Open (new tab), Download, Copy link, and — for members who can write — Delete.
9. A failed upload shows the error with Retry and Remove, and Retry re-uploads the same file without needing a re-pick.
10. Everything survives a reload: the card, its thumbnail, name, size, and position come back from the widget row.
11. Deleting the widget removes the row and enqueues the Cloudinary asset for destruction; the cron sweep completes it if the immediate attempt fails.
12. A view-only member sees existing document cards and can open/download them, but gets no picker, no drop target, and no Delete.

## Data and schema

No migration. The widget's `data` JSONB carries:

```ts
{ status: "empty" }
{ status: "uploading" }
{ status: "ready", url, publicId, resourceType: "image" | "raw", kind: "pdf" | "word", name, bytes }
{ status: "error", message }
```

`publicId` and `resourceType` are new relative to `media`, and exist so the delete path can destroy the asset. Existing rows are untouched; `media` widgets already on canvases keep working exactly as they do now.

## Security

- **Upload signature:** unchanged route, unchanged auth — `getRequestIdentity` + `canWriteEntries` + `checkRateLimit("upload:<userId>")`, signature scoped to `helm-canvas/${organizationId}`. Note the existing quirk: the upload route gates on `canWriteEntries` while the canvas gates on `canWriteWidgets`; both resolve to owner/admin today, so behaviour is identical. Not changing it here.
- **Widget writes:** `createWidgetAction` / `updateWidgetDataAction` / `deleteWidgetAction` already check `canWriteWidgets` and scope by `organizationId`. The new delete path reads the row through the same organization-scoped query, so a `publicId` from another workspace is unreachable.
- **No new secret reaches the browser.** The Cloudinary API secret stays in the signing route; the client gets a timestamped signature and the public cloud name, as today.
- **Delivered URLs are Cloudinary `secure_url`s** rendered in an `<iframe>`/`<a>`; nothing is fetched from an arbitrary user-supplied origin, and the overlay renders no HTML from the file.
- **Rate limiting:** unchanged, `checkRateLimit` on signature issuance — one per upload.

## Client data flow

- No new TanStack Query keys. The widget's state is canvas state, persisted through the existing debounced `updateWidgetData` path, exactly like `media`.
- `deleteWidget` still goes through the existing `useMutation` in `use-widget-actions.ts`; only the server action's body grows.
- Nothing new is persisted to localStorage; the pending `File` stays in the in-memory `pendingFiles` map and is deliberately not persistable — an interrupted upload shows "Upload was lost", same wording `media` uses.

## Acceptance criteria

- [ ] Drop, paste, and picker all produce an uploading card with real progress.
- [ ] PDF card shows a first-page thumbnail; Word card shows a file-type icon.
- [ ] PDF opens in the in-app viewer; Word downloads.
- [ ] Wrong type and oversize are both refused with a toast, before any upload.
- [ ] Retry works without re-picking the file.
- [ ] Reload restores every finished card intact.
- [ ] Delete enqueues a `cloudinary_cleanup_jobs` row for the asset.
- [ ] A view-only member gets read-only cards and no picker.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run`
- [ ] `timeout 150 npx next build`

## Manual test steps

Run `npm run dev` (port 3001), sign in as an owner/admin of a workspace, open its canvas.

1. Drag a PDF from the desktop onto empty canvas → card appears, progress runs, settles into a thumbnail of page 1 with filename and size.
2. Click the card → viewer overlay opens, the PDF scrolls, Escape closes it.
3. Right-click the card → Copy link, paste it in a new tab; the PDF opens from Cloudinary.
4. Drag a `.docx` on → card shows the Word icon, name and size; clicking it downloads the file.
5. Add "Document" from the right-edge toolbar → picker card; choose a PDF through the file dialog → same upload flow.
6. Drag a `.png` onto the canvas → still becomes a media widget, not a document.
7. Drag a `.zip` onto a document picker card → rejected with a toast, card stays a picker.
8. Reload the page → every card comes back exactly as it was.
9. Right-click a card → Delete; check `cloudinary_cleanup_jobs` (`npm run db:studio`) for a new pending row with that `publicId`.
10. Open the same workspace as an invited view-only member → cards render, open and download work, no picker and no Delete item.

## Follow-ups

- **Cloudinary blocks PDF delivery by default** ("Allow delivery of PDF and ZIP files" in Settings → Security). If step 2 and 3 return a 401 from Cloudinary, that setting is the cause, not this code. The user needs to enable it on the account.
- Existing `media` widgets never stored a `publicId`, so their Cloudinary assets still leak on delete. The new `deleteWidgetAction` fixes this for anything uploaded from now on; backfilling old media widgets is a separate pass.
- Word previews would need Cloudinary's paid document-conversion add-on. Revisit only if the icon card proves not to be enough.
- PPTX/XLSX are deliberately out of scope; adding them is one entry in `classifyDocumentFile` plus an icon, if they are ever wanted.
