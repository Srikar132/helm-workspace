# Widget sizing model: one stored size, one table (issue #18)

**Date:** 2026-10-09
**Branch:** `feature/widget-sizing-model` (off `main`)
**Status:** implemented (manual pass pending)

## Goal

GitHub issue #18, "Fix inconsistent widget sizing and resizing behavior": widgets grow taller than their content needs, resizing makes a widget jump back to its content's size, and the resizable / non-resizable split is spread across several places.

Done means one rule that holds for every widget, the way Figma frames, tldraw shapes and Miro cards behave: **the saved width and height are the widget's size.** What you see equals what is stored, before and after a move, resize, save and reload. Content that does not fit scrolls inside the card. Nothing measures content to decide a size.

## What I read

- `AGENTS.md`, `CLAUDE.md`, `prompts/README.md`, `prompts/TEMPLATE.md`
- `.claude/context/progress-tracker.md` — grepped for sizing history. Bug 8 (draft forms could not be resized) and Bug 14 (height pinned instead of following content) are what introduced the current content-height mode.
- Files inspected:
  - `components/canvas/widget-registry.ts` — `NON_RESIZABLE_WIDGET_TYPES`, `CONTENT_HEIGHT_TYPES`, `AUTO_HEIGHT_MIN`, `NEW_WIDGET_DEFAULTS`, `DEFAULT_LAYOUT`, `isWidgetResizable` + `isDraftWidget`, `resolveHeight`, `buildNode`. This is where the model is split.
  - `components/canvas/widget-node.tsx` — `NodeResizer` with fixed `RESIZE_MIN_WIDTH/HEIGHT` (160/100) and no max; applies `data.minHeight` as an inline `minHeight` on the card.
  - `components/canvas/hooks/use-widget-layout.ts` — saves `dimensions` changes only when `resizing === false`.
  - `components/canvas/hooks/use-widget-actions.ts` — `addWidget` (defaults, drop-point centring), `resizeWidget` (explicit node size + save).
  - `lib/actions/widgets.ts` — `createWidgetAction` / `updateWidgetSizeAction` validate only `min(80)`; `height` is nullable; `rowToItem` maps `null` to "no height".
  - `lib/db.ts` — `widgets.height` is a nullable integer meaning "auto-height".
  - `lib/canvas/widget-interaction.ts` — takes `{ resizable }` as an input to resolve `showResizeControls`.
  - `components/canvas/landmark-widget.tsx` — already does the draft-to-saved size change once, with `resizeWidget(id, LANDMARK_PIN_SIZE)`.
  - `tests/widget-height.test.ts`, `tests/widget-resizable.test.ts`, `tests/widget-interaction.test.ts`.

## The mistakes this removes

1. **One number, two meanings.** `resolveHeight` makes a stored height a fixed size for board/media/landmark but a *floor* for note, project-doc, bookmark, code and gallery. While you work, `NodeResizer` writes a hard height; after reload the same number becomes a floor. Shrink a note below its content: clipped now, springs back after reload.
2. **Stale floor.** `data.minHeight` is computed once in `buildNode`. After a resize the card keeps the old floor, overflows its own xyflow box, and the handles sit in the wrong place.
3. **`null` height means two things** ("never sized" and "hug content"), and a manual resize destroys it with no way back.
4. **Constants disagree and nothing is capped:** client minimum 160x100, server minimum 80, per-type floors, no maximum anywhere; defaults live in `DEFAULT_LAYOUT`, `NEW_WIDGET_DEFAULTS`, `LANDMARK_PIN_SIZE` and the database.
5. **Resizability is decided by a type set, a draft predicate and the interaction table together.**

## Decisions and assumptions

- **Decision:** a widget's size is always the stored `width` x `height`. No content-height mode, no `heightMode` column, no measuring. This is how Figma (fixed frames), tldraw (stored `w`/`h`) and Miro behave, and it is the React Flow recommendation: `measured` is output only, explicit `width`/`height` on the node is the size.
- **Decision:** one pure module, `lib/canvas/widget-sizing.ts`, holds a table per widget type: `default`, `min`, `max`, `resizable`. It has no React or DB imports so the client and the server action read the same numbers. It exports `defaultSize(type)`, `clampSize(type, size)` and `isResizable(type)`.
- **Decision:** resizability depends on the type only. The draft exception is deleted. A draft form (bookmark, gallery, landmark) opens at a default size that fits the form, and on save the widget sets its saved size once through `resizeWidget`, which is the pattern landmark already uses.
- **Decision:** no migration. Rows with `height = null` (every auto-height widget today) fall back to the type's default height when loaded (`rowToItem`). The column stays nullable so a rollback still works, but nothing writes `null` any more.
- **Decision:** the server clamps `createWidgetAction` and `updateWidgetSizeAction` to the table, so a hand-crafted request cannot store an absurd size.
- **Assumption (correct me):** notes, project cards, bookmarks and the code card no longer grow with their content. They keep their size and scroll. This is the trade for a size that never changes unexpectedly.
- **Assumption:** the numbers in the table below are starting points. Draft-form heights for bookmark, gallery and code are measured against the real forms during implementation, so no form is clipped at its default size.
- **Assumption:** `draw` has no meaningful size (pinned at the origin, canvas-space strokes) and is excluded from the table.
- **Risk to check:** the project-doc edit form (Bug 14, about 470px tall). It must scroll inside the card or the card default must fit it. I will test it at the default and at the minimum size.
- **Rejected:** a stored `heightMode` column (tldraw's `autoSize`). Right for products with a "hug" mode, but it adds a column, a migration and a toggle UI for a feature this issue is asking us to stop having.
- **Rejected:** measuring content with a `ResizeObserver` and writing sizes back. This is what the old comments call "feeding back on itself".
- **Rejected:** keeping content-height for the note only. It would keep both meanings alive.

## Sizing table (starting values)

| Type | Default (w x h) | Min | Resizable |
| ---- | --------------- | --- | --------- |
| board | 1180 x 660 | n/a | no |
| mail-summary | 340 x 420 | n/a | no |
| markdown | 340 x 240 | 160 x 100 | yes |
| project-doc | 320 x 200 | 220 x 140 | yes |
| media | 360 x 280 | 120 x 90 | yes |
| bookmark | 380 x draft form height; saved row height | 260 x row height | no (saved size set on save) |
| gallery | 260 x draft form height; saved icon size | n/a | no (saved size set on save) |
| code | 320 x card height incl. title line | n/a | no |
| landmark | 300 x 400 draft; 190 x 220 pin | n/a | no |

A common `max` (for example 2400 x 2400) applies to every resizable type. Non-resizable types ignore min and max.

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `lib/canvas/widget-sizing.ts` | new — the table, `defaultSize`, `clampSize`, `isResizable` |
| `components/canvas/widget-registry.ts` | edit — delete `CONTENT_HEIGHT_TYPES`, `AUTO_HEIGHT_MIN`, `NON_RESIZABLE_WIDGET_TYPES`, `NEW_WIDGET_DEFAULTS`, `resolveHeight`, `isWidgetResizable`, `isDraftWidget`; `buildNode` always sets `width`/`height` from the item (fallback `defaultSize`); `DEFAULT_LAYOUT` reads the table |
| `components/canvas/widget-node.tsx` | edit — drop `minHeight` data/style; `NodeResizer` min/max from the table; `resizable = isResizable(type)` |
| `components/canvas/hooks/use-widget-actions.ts` | edit — `addWidget` uses `defaultSize` (always has a height) |
| `components/canvas/hooks/use-widget-layout.ts` | edit — clamp before saving a resize |
| `lib/actions/widgets.ts` | edit — clamp in create/size actions; `height` non-null on write; `rowToItem` falls back to `defaultSize` |
| `components/canvas/bookmark-widget.tsx`, `gallery-widget.tsx` | edit — set the saved size once on save (via `resizeWidget`); inner content scrolls |
| `components/canvas/code-widget.tsx`, `project-doc-widget.tsx`, `markdown-widget.tsx` | edit — content scrolls inside the fixed card |
| `components/canvas/landmark-widget.tsx` | edit — `LANDMARK_PIN_SIZE` moves into the table |
| `tests/widget-sizing.test.ts` | new — table, clamp, defaults, fallback for `null` height, resize then rebuild round trip |
| `tests/widget-height.test.ts`, `tests/widget-resizable.test.ts` | delete — replaced by the new test |
| `AGENTS.md` (section 9) | edit — a short "Sizing" paragraph pointing at the table |
| `.claude/context/progress-tracker.md` | edit — record the decision and the rejected alternatives |

No migration and no `.env.example` change.

## Requirements

1. Every widget type in the table has a default size, and a new widget is created with exactly that size.
2. A widget's rendered size equals its stored size. No component sets a `minHeight` or lets content change the card's box.
3. Resizing a resizable widget changes its stored size. After a move, a content edit, save and reload it has the same size (no snap-back).
4. Resize limits come from the table on the client (`NodeResizer`) and on the server (clamp). A resize cannot go below the minimum or above the maximum.
5. A non-resizable widget shows no resize handles and keeps its size, including a draft that has been saved.
6. Content larger than the card scrolls inside it. The card never grows.
7. An existing widget with `height = null` loads at its type's default height, with no data loss and no migration.
8. There is one place that answers "what size, what limits, resizable or not" for each type.

## Data and schema

None. `widgets.height` stays nullable and unused for `null` going forward. Existing `null` rows are read as the type default; the next resize or creation writes a number.

## Security

- No new entry point. `createWidgetAction` and `updateWidgetSizeAction` keep `requireViewerContext()`, `canWriteWidgets`, `widgetWhere(id, organizationId)` scoping and `checkDragRateLimit`.
- The new server-side clamp is defence in depth against crafted sizes; the client table is a convenience.
- No secret involved.

## Client data flow

- No new query keys or mutations. Resizing keeps the existing debounced per-widget `updateWidgetSizeAction` save (500 ms, retried once, shared failure signal).
- `resizeWidget` (used on draft-to-saved) keeps writing the node size and saving it.
- Nothing is persisted to localStorage.

## Acceptance criteria

- [ ] No `CONTENT_HEIGHT_TYPES`, `AUTO_HEIGHT_MIN`, `resolveHeight`, `isDraftWidget` or inline `minHeight` remains in `components/` or `lib/`.
- [ ] Resize a note smaller than its text, reload: same size, text scrolls.
- [ ] Resize a note, edit its text, move it, reload: same size.
- [ ] Resize handles cannot cross the min/max, and a crafted request above max is clamped by the server.
- [ ] Bookmark and gallery drafts fit their forms at the default size; saved cards snap to their saved size once and then stay.
- [ ] The project-doc edit form is usable at the default and at the minimum size.
- [ ] An old `height = null` widget loads at the default height.
- [ ] The sizing doc paragraph is in AGENTS.md and the tracker.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run`
- [ ] `timeout 150 npx next build`
- [ ] Schema checks: not applicable

## Manual test steps

In `npm run dev` (port 3001), as a workspace owner:

1. Drag each creatable widget from the toolbar and confirm it appears at the table's default size.
2. Resize a note to be short and type many lines. The text scrolls and the card does not grow.
3. Reload. The note has the same size and text.
4. Drag the note elsewhere, reload, same size.
5. Create a bookmark: the form fits. Save it. The card shrinks once to its saved size and has no resize handles.
6. Repeat step 5 for a gallery and a landmark.
7. Open a project-doc card's edit form at the default size and after shrinking it to the minimum. The form is usable (scrolls).
8. Try to resize a note past the min and max. The handles stop there.
9. Open a workspace that already has old auto-height widgets. They load at the default height and nothing disappears.
10. As a view-only member, confirm no handles appear and nothing is saved.

## Follow-ups

- Whether notes should offer a "fit to content" action later is a separate decision.
- The pre-existing ESLint errors in `draw-canvas-overlay.tsx` and `canvas-actions-context.tsx` are unrelated and untouched.
- Record the final measured draft heights in the tracker once implemented.
