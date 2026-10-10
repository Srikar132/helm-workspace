# Canvas image widget: real Download/Copy and a zoom viewer (follow-up to #30/#33)

**Date:** 2026-10-10
**Branch:** `feature/gallery-viewer-actions` (same branch as prompt 09)
**Status:** approved (scope chosen by the user in the question panel: "Actions + zoom"); built

## Goal

Images that sit on the canvas as `media` widgets had the same two bugs fixed on the gallery page and no way to look closer. Done = right-click Copy image / Copy link / Download behave like the gallery's, and an image can be opened in the same zoom/pan viewer.

## What I read

- `AGENTS.md`, `CLAUDE.md`, progress tracker, `prompts/09-gallery-viewer-and-actions.md`
- `components/canvas/media-widget.tsx` — its own `copyImage` does `new ClipboardItem({ [blob.type]: blob })`, which throws for JPEG/WebP in most browsers and then **silently falls back to copying the link** (user thinks they copied the image); its `download` is the same ignored-cross-origin `<a download target=_blank>`; Copy link is unhandled and silent; no viewer.
- `components/albums/lightbox.tsx`, `zoomable-image.tsx`, `image-actions.ts` — the pieces to reuse.

## Decisions and assumptions

- **Decision:** reuse `image-actions.ts` (`copyImage`, `copyLink`, `downloadItem`) in the media widget; delete its private copies. Videos get Download (via `fl_attachment`) and Copy link, no Copy image.
- **Decision:** new `ImageViewerOverlay` (single image, no prev/next, no album actions): `ZoomableImage` + close button + Copy image / Copy link / Download. Opens on **double-click** of the image and from a **"View full size"** context-menu item (touch users have no right-click).
- **Decision:** the overlay is **portalled to `document.body`**. A canvas node sits inside xyflow's transformed viewport, and `position: fixed` inside a transformed ancestor is positioned against that ancestor, not the screen. The overlay root also stops pointer/click/key events from bubbling up the React tree (portals bubble through React parents) so a drag or Delete key inside the viewer can't reach the widget or canvas.
- **Decision:** the dialog behaviour (scroll lock, focus in/out, Escape, Tab trap) is extracted from `Lightbox` into `use-modal-dialog.ts` so both viewers share one implementation instead of two copies.
- **Decision:** `ZoomableImage`'s prop type loosens from `AlbumImageRow` to `{ url, name, kind }`; the media widget has no stored name, so downloads fall back to `image` / `video`.
- **Rejected:** opening the media widget in the album `Lightbox` (it needs groups, mutations and a list of siblings that a lone canvas image doesn't have); pre-selecting zoom on single click (single click is how a widget is selected/dragged).

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `components/albums/use-modal-dialog.ts` | new — scroll lock, focus management, Escape, Tab trap |
| `components/albums/image-viewer-overlay.tsx` | new — portalled single-image viewer |
| `components/albums/lightbox.tsx` | edit — use `useModalDialog` |
| `components/albums/zoomable-image.tsx` | edit — loosened image prop type |
| `components/canvas/media-widget.tsx` | edit — shared actions, double-click + menu item open the viewer |
| `lib/album-file.ts`, `tests/album-file.test.ts` | edit — `video` filename fallback |
| `.claude/context/progress-tracker.md` | edit |

No migration, env key or dependency.

## Requirements

1. Right-click an image widget → Copy image puts a PNG on the clipboard and toasts; failure toasts (no silent link fallback).
2. Download downloads a file (no new tab) for images and videos; Copy link toasts.
3. Double-click an image widget, or choose View full size, opens the zoom/pan viewer above the canvas; Escape / Close / backdrop tap closes it; the canvas does not pan, select or delete anything while it is open.
4. View-only members get all of it (none of it writes).
5. Videos keep native controls and are unaffected by double-click.

## Data, security, client data flow

None / none / none: no schema, no server action, no query key; the actions only read a URL the page already holds.

## Checks and manual test

Same four checks as prompt 09. Manual: paste an image onto the canvas, right-click → Copy image, paste elsewhere; Download; double-click → zoom, pan, pinch, close with Escape; press Delete while the viewer is open and confirm the widget is still there; repeat as a view-only member.
