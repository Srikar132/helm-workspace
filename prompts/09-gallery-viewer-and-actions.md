# Gallery viewer, image actions and touch drag (issues #30, #32, #33)

**Date:** 2026-10-10
**Branch:** `feature/gallery-viewer-actions` (off `main`)
**Status:** approved; built, checks green, manual browser pass still to do

## Goal

Three gallery-detail-page issues, one branch because they all live in `components/albums/` and #30 and #33 both end up in the lightbox:

- **#30** — the lightbox gets zoom, pan, pinch, reset-to-fit, load/error states and proper dialog accessibility.
- **#32** — scrolling the grid on a phone must never pick up a tile; dragging into a group stays possible, but only on a deliberate long press.
- **#33** — a real **Copy image** action and a **Download** that downloads (with a filename) instead of opening a tab, with success/failure feedback, available to view-only members too.

Done = every acceptance criterion on the three issues holds in the running app on desktop and at phone width.

## What I read

- `AGENTS.md`, `CLAUDE.md`, `.claude/context/progress-tracker.md`
- `components/albums/lightbox.tsx` — a lightbox already exists (prev/next, Escape, rename/duplicate/move/delete bar). It has **no zoom/pan, no load or error state, no dialog semantics**, and the whole action bar (including Download and Copy link) is wrapped in `canWrite`, so a view-only member can neither download nor copy.
- `components/albums/album-grid.tsx` — `downloadItem()` builds `<a download target=_blank>`; for a cross-origin Cloudinary URL the browser **ignores `download`** and opens the tab — that is #33's bug. `AlbumTile` sets `style={{ touchAction: "none" }}` on the whole tile — that stops the browser scrolling from any swipe that starts on a tile, and is half of #32.
- `components/albums/album-view.tsx` — `useSensors` registers **`PointerSensor` (distance 5) and `MouseSensor` and `TouchSensor` (delay 150, tolerance 5)**. `pointerdown` fires before `touchstart`, so on a phone PointerSensor wins and activates after 5px of movement, which is the "image attaches to my finger" in #32. `handleDragStart` also opens the sidebar (the only drop targets).
- `components/albums/bulk-action-bar.tsx` — second caller of `downloadItem`; fires staggered downloads.
- `lib/album-file.ts` — Cloudinary URL helpers; the `/upload/` + transformation-segment pattern already exists (`pdfThumbnailUrl`, `albumStackThumbnailUrl`). New URL helpers belong here, pure and tested (`tests/album-file.test.ts`).
- `lib/toast.ts` / `components/ui/toast.tsx` — `toastManager.add({ title, description, type })` is the existing feedback channel (mounted in `app/providers.tsx`).
- Prior art: tracker "Bug 5" — the canvas toolbar had the identical PointerSensor-beats-TouchSensor conflict and was fixed by removing PointerSensor and using press-and-hold with a movement tolerance. Same fix here.
- `package.json` — no gesture/zoom library installed; `framer-motion`, `@dnd-kit/*`, `lucide-react` are.

## Decisions and assumptions

### #33 — copy / download
- **Decision (download):** add Cloudinary's `fl_attachment:<filename>` transformation to the URL (`attachmentUrl(url, name)` in `lib/album-file.ts`) and navigate an `<a href download>` to it. Cloudinary then answers with `Content-Disposition: attachment`, which makes the browser download for real — cross-origin, on iOS Safari and Android Chrome — with no bytes through our server and no CORS dependency. The format is preserved because the original is delivered untouched. Alternative (fetch → blob → object URL) needs CORS, loads the whole file into memory and misbehaves on iOS; kept only as the fallback for a URL that has no `/upload/` segment.
- **Decision (filename):** `item.name` sanitised for the transformation (Cloudinary rejects `/ , ? # %` etc.), extension re-attached from the stored URL when the name lacks one, `"image"`/`"document"` fallback when there is no name.
- **Decision (copy image):** `navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })])`. Only PNG is universally accepted by the async clipboard API, so the fetch asks Cloudinary for `f_png` (Cloudinary sends `Access-Control-Allow-Origin: *`, verified before building). The blob is passed as a **promise** so Safari accepts it (it requires the write to start inside the user gesture). Images only — PDFs/Word get Copy link and Download.
- **Decision (fallbacks):** `ClipboardItem` missing or write rejected → error toast and the Copy link action stays one click away; Download that cannot build a Cloudinary URL → blob fallback → error toast. Copy link also gets a success/failure toast (today it is silent, and an unhandled rejection on insecure origins).
- **Decision:** Copy image / Copy link / Download move **out of the `canWrite` gate**. They read, they do not mutate; a view-only member being unable to download a photo of their own workspace is a bug, not a policy. Rename/Duplicate/Move/Delete stay gated.
- **Decision:** one shared module `components/albums/image-actions.ts` (`downloadItem`, `copyImage`, `copyLink`, each toasting) used by lightbox, tile menu and bulk bar. `downloadItem` leaves `album-grid.tsx`.
- **Assumption:** the tile menu (`⋯`) gets "Copy image" too, for images only. Bulk download keeps its 300ms stagger but now goes through `attachmentUrl`, so it also actually downloads.

### #30 — lightbox viewer
- **Decision:** hand-rolled pan/zoom, no new dependency. Pointer events: wheel zoom to cursor (Ctrl/trackpad-pinch and plain wheel both zoom, since the overlay has nothing to scroll), drag-to-pan when zoomed, two-pointer pinch, double-click/double-tap toggles fit ↔ 2.5×, buttons `−  +  Fit` with `aria-label`s, keyboard `+` `-` `0`. The maths (clamp scale 1–8, clamp translate so the image cannot be flung off-screen, zoom-about-a-point, pinch centroid) is a pure module `lib/pan-zoom.ts` with unit tests; the component only wires events.
- **Decision:** pan never closes the viewer. Backdrop-click close only fires when the pointer did not move (> 4px movement = a drag) and only on the backdrop element itself — today every click inside the stage calls `stopPropagation`, and the image sits in a stage that is not the backdrop, so this stays safe.
- **Decision:** while zoomed (> 1×), arrow keys pan and the prev/next chevrons stay; at fit, arrows navigate as today. Changing image resets zoom (the image is keyed already).
- **Decision:** loading spinner until `onLoad`; `onError` shows an "Image failed to load" panel with a Retry (re-sets `src` with a cache-bust query) and a Download link, so the viewer is never a black screen.
- **Decision (accessibility):** `role="dialog" aria-modal="true" aria-label=<name>`; focus moves to the Close button on open and returns to the opening tile on close; Tab is trapped inside the overlay; body scroll locked while open (`overflow: hidden`) so the grid underneath cannot scroll or be clicked; the live region announces "Image 3 of 12"; `prefers-reduced-motion` skips the scale-in.
- **Decision (mobile close):** the visible Close button plus Escape (hardware keyboards) plus backdrop tap at fit. A swipe-down-to-close gesture was considered and **rejected**: it collides with pan once zoomed and with the browser's pull-to-refresh, for no gain over a 44px button.
- **Assumption:** the issue says "open an image in an overlay from the gallery detail page" — the lightbox already opens on tile click, so this is an upgrade of the existing viewer, not a second one. PDFs keep `DocumentViewerOverlay`; Word keeps downloading.

### #32 — touch drag vs scroll
- **Decision:** remove `PointerSensor`; keep `MouseSensor` (distance 5, desktop unchanged) and `TouchSensor` with `{ delay: 350, tolerance: 8 }`. A swipe moves more than 8px before 350ms elapses, which cancels the drag attempt and leaves the browser free to scroll; only a held finger starts a drag.
- **Decision:** `touchAction: "none"` on the tile becomes `manipulation` (browser keeps pan + pinch, drops double-tap-zoom delay). dnd-kit's TouchSensor `preventDefault`s `touchmove` once active, so the drag still owns the gesture after the long press.
- **Decision (communicate draggability):** on activation fire `navigator.vibrate?.(12)` (Android; iOS has no API, harmless no-op) and the existing `DragOverlay` thumbnail lifts under the finger. Tile gets `-webkit-touch-callout: none` and `user-select: none` so iOS's own long-press image menu does not fight the 350ms hold. No always-visible grip on tiles: it would add chrome to every tile on every phone to solve a gesture that now behaves like every other mobile list.
- **Decision:** no drag at all while `selectionMode` or `selectedIds.size > 0` on a touch device: in selection mode a tap toggles selection, and a held finger on a checked tile starting a drag surprised users in the old build. Multi-drag from a selection still works on desktop mouse (unchanged).
- **Assumption (please correct):** "explicit drag handle or drag mode" in the issue is offered as *possible approaches*, "or" not "and". I chose long-press as the least UI. If you would rather have a visible grip handle on touch, say so — it is a contained change to `AlbumTile`.
- **Rejected:** `PointerSensor` with `pointerType === "mouse"` filtering (a custom sensor to maintain for the same outcome as removing it); a global "drag mode" toggle button (extra state, and it does not help the user who never finds it).

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `lib/pan-zoom.ts` | new — pure clamp / zoom-at-point / pinch maths |
| `tests/pan-zoom.test.ts` | new — scale clamp, translate clamp, zoom keeps the anchor point fixed, pinch centroid |
| `lib/album-file.ts` | edit — `attachmentUrl(url, name)`, `pngUrl(url)`, `downloadFileName(item)` |
| `tests/album-file.test.ts` | edit — attachment/png URL cases, filename sanitising, no-`/upload/` passthrough |
| `components/albums/image-actions.ts` | new — `downloadItem`, `copyImage`, `copyLink`, each with toast feedback + fallbacks |
| `components/albums/use-pan-zoom.ts` | new — pointer/wheel/pinch/key wiring over `lib/pan-zoom.ts` |
| `components/albums/zoomable-image.tsx` | new — the lightbox stage: image, zoom controls, loading and error states |
| `components/albums/lightbox.tsx` | edit — zoom controls, stage transform, load/error states, dialog a11y, actions out of `canWrite`, Copy image |
| `components/albums/album-grid.tsx` | edit — drop local `downloadItem`; `touchAction: manipulation`, callout/select none; tile menu uses shared actions + Copy image; drag disabled in selection |
| `components/albums/album-view.tsx` | edit — sensors (remove PointerSensor, new TouchSensor timing), haptic on drag start, import path for `downloadItem`, pass opener ref for focus return |
| `components/albums/bulk-action-bar.tsx` | edit — import `downloadItem` from the new module |
| `.claude/context/progress-tracker.md` | edit — record the work and the rejected options |

No migration, no new env key, no new dependency.

## Requirements

1. Clicking a photo opens the lightbox; `+`/`−` buttons, mouse wheel, double-click and `+`/`-` keys zoom between 1× and 8×; **Fit** (and key `0`) returns to the fit view.
2. When zoomed, dragging pans, is clamped so the image cannot leave the stage entirely, and releasing the drag does **not** close the viewer.
3. On a touch device two-finger pinch zooms about the pinch centre and one finger pans when zoomed; double-tap toggles fit/2.5×.
4. Escape, the Close button, and a click on the bare backdrop (at fit, without movement) close it; the underlying grid cannot be scrolled or clicked while it is open; focus lands on Close on open and returns to the tile on close.
5. A slow image shows a spinner; a failed image shows an error panel with Retry and Download — never a blank stage.
6. **Copy image** puts a PNG on the clipboard where `ClipboardItem` is supported and toasts success; where it is not, or the write is rejected, it toasts a clear failure (and says Copy link is available).
7. **Download** downloads a file named after the item (sanitised, extension preserved) on desktop Chrome/Firefox/Safari and mobile Chrome/Safari instead of opening a tab; failure toasts.
8. Copy image, Copy link and Download are visible to view-only members; rename/duplicate/move/delete still require `canWrite`.
9. On a touch device, scrolling the grid by swiping across tiles never starts a drag; holding a tile ~350ms starts one (haptic where available) and it can be dropped on a group; releasing the hold without moving still just opens/selects as before.
10. Desktop mouse drag-and-drop is unchanged (5px threshold, same drop targets, same confirm dialog); selection, group navigation, uploads, bulk bar all still work.

## Data and schema

None.

## Security

- No new entry point. Every mutation the lightbox exposes still goes through the existing album server actions, which resolve identity with `requireViewerContext()`, scope by `organizationId`, and check `canWriteEntries`-class predicates; moving Download/Copy out of the `canWrite` UI gate does not touch any server check — those actions are pure client reads of a URL the viewer's page already received.
- `attachmentUrl` / `pngUrl` only rewrite a URL string we stored; the filename placed in the transformation is sanitised to `[A-Za-z0-9._-]` + spaces→`_` and length-capped, so a hostile file name cannot inject extra transformation segments or a path.
- No secret involved (Cloudinary delivery URLs are public by design; the API secret stays server-side).
- No rate limiting: nothing here calls a server action that is not already limited.

## Client data flow

- No query keys added or changed; lightbox mutations still call `onChanged` → `invalidateAlbum()` which invalidates `["albumImages", albumId]` and `["albumPreview", albumId]` as today.
- Nothing new is persisted; zoom/pan state is component-local and resets per image.

## Acceptance criteria

- [ ] Reqs 1–5: lightbox zoom/pan/reset/close/loading/error behave as listed, mouse + keyboard + touch, at 360px and 1280px.
- [ ] Reqs 6–8: copy and download work with feedback, filenames sensible, view-only member sees them.
- [ ] Reqs 9–10: phone scroll never grabs a tile; long-press drag works; desktop drag unchanged.
- [ ] `tests/pan-zoom.test.ts` and the new `album-file` cases pass.
- [ ] No new lint warnings.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run` (the two known pre-existing failures — `summary-parser`/`constants` filler phrases and `widget-resizable` — are not from this change)
- [ ] `timeout 150 npx next build`

## Manual test steps

Use a workspace with an album containing a few photos, one PDF, one Word file, and two groups. Do desktop first, then Chrome DevTools device mode (touch emulation, 390×844) or a real phone on the LAN at `http://<pc-ip>:3001`.

1. Desktop, owner: open the album, click a photo. Wheel up/down zooms about the cursor; `+`/`−` buttons and keys work; drag a zoomed image around — it never closes; **Fit**/`0` resets; Escape closes and focus returns to the tile.
2. Click the bare dark backdrop at fit → closes. At zoom, release a pan drag on the backdrop → stays open.
3. DevTools throttle to "Slow 3G" and open a photo → spinner. Block the image URL in Network and open it → error panel; Retry works after unblocking.
4. Press **Copy image**, then paste into an image editor / chat → you get the photo; toast says copied. Try in Firefox (no `ClipboardItem` write in older builds) → failure toast mentions Copy link.
5. Press **Download** → a file named after the photo downloads (check extension), no new tab opens. Repeat from the tile `⋯` menu and from a multi-select bulk Download.
6. Sign in as an invited **view-only** member: open the same lightbox → Copy image, Copy link, Download present; Rename/Duplicate/Move/Delete absent.
7. Device mode (touch): swipe-scroll the grid starting on tiles, fast and slow → page scrolls, nothing drags. Pinch the lightbox image, pan with one finger, double-tap to toggle.
8. Touch: press and hold a tile ~half a second → it lifts (vibrates on Android), the group sidebar opens, drop on a group → the Move/Duplicate dialog appears.
9. Touch with selection mode on: tap toggles selection, no accidental drag.
10. Desktop: drag a tile onto a sidebar group with the mouse → unchanged.

## Follow-ups

- Swipe left/right to change photo in the lightbox is **not** in these issues; left out.
- Signed-in Cloudinary delivery (private/authenticated assets) would break `fl_attachment` the same as every other URL here; all current assets are public upload type.
- If the user wants a visible grip handle on touch (see #32 assumption), that is a separate small change.
