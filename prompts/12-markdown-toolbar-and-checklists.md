# Markdown note: selection-anchored toolbar, slash menu, working checklists

**Date:** 2026-10-10
**Branch:** `feature/markdown-toolbar-checklist` (off `main`)
**Status:** approved (v2 — revised after user feedback: toolbar must follow where I'm typing, like Notion/Whimsical). Built; browser pass pending.

Issue: https://github.com/Srikar132/helm-workspace/issues/12

## Goal

The formatting UI of a markdown note appears where the user is working, not parked above the card. Checklists are reliable and fully usable. Done = the issue's five acceptance criteria hold in the running app.

## What I read

- `AGENTS.md`, `CLAUDE.md`, `.claude/context/progress-tracker.md`
- `components/canvas/markdown-widget.tsx` — editor in an `overflow-y-auto` div; pushes a toolbar to `WidgetNode` via `setFloatingToolbar` while `editing && canWrite`.
- `components/canvas/widget-node.tsx` (l.266-272) — renders that toolbar `absolute bottom-full` above the card. **This is the user's complaint:** the toolbar is pinned above the card top while they type at the bottom (far from the caret, hidden/clipped when the card is near the viewport top, scales with canvas zoom).
- `components/canvas/note-toolbar.tsx` — one wide bar: inline marks, H1/H2, bullet/ordered/task list, quote, text colour, highlight, font size, **card background colour, delete note**.
- `lib/tiptap/note-extensions.ts` — shared schema (notes AND docs). `TaskList` + `TaskItem{nested}` already present; `@tiptap/markdown` already has parse/render for them. `@tiptap/suggestion` + `@floating-ui/dom` already installed (mentions use them).
- `node_modules/@tiptap/react/menus` + `@tiptap/extension-bubble-menu@3.30.1` — installed, version-matched; `BubbleMenu` supports `appendTo` and floating-ui options (`strategy`, `placement`, `offset`, `flip`, `shift`).
- `app/globals.css` l.550-573 — `.prose-note` task list: native checkbox, checked text struck through; no focus/hover styling.
- `tests/markdown-editor.test.ts` l.162 — only asserts a markdown checklist parses to `taskList`/`taskItem`. No serialize-back, `checked` round trip, nesting, or move coverage.

## How Notion and Whimsical do it (the model being copied)

- **Notion:** no always-on toolbar. Selecting text shows a small floating bar *attached to the selection* (bold/italic/underline/strike/code/link/colour). It flips below when there is no room above and shifts to stay on-screen. Block changes (headings, bullets, **to-do list**, quote…) come from the **`/` slash menu** at the caret, plus markdown shortcuts (`- `, `[] `, `# `). Reorder blocks with a drag handle.
- **Whimsical:** formatting controls float next to the thing being edited (selected text or the object), never in a fixed header; object-level settings (colour etc.) are a separate small contextual chip.
- Common rule: *inline formatting follows the selection; block insertion follows the caret; object-level settings are separate chrome.* That is the split below.

## Decisions and assumptions

- **Decision — inline toolbar = selection bubble.** Use Tiptap `BubbleMenu` (`@tiptap/react/menus`) with `appendTo: document.body`, `strategy: "fixed"`, `placement: "top"`, offset, `flip` + `shift`. Appended to `body` so it is **not** scaled by canvas zoom, not clipped by the card's `overflow`, and cannot overlap the selected text. Contents: bold, italic, underline, strike, code, text colour, highlight, font size. Shown only when `editing && canWrite` and the selection is non-empty.
- **Decision — block formatting = `/` slash menu** at the caret (`@tiptap/suggestion`, same pattern as `lib/tiptap/use-mention-suggestion` / `mention-suggestion.tsx`): Heading 1, Heading 2, Bullet list, Numbered list, **Checklist**, Quote. Markdown input rules (`- `, `[ ] `, `# `) keep working untouched. Registered in the shared extension list (docs pages get it too) but only active when an editor is editable.
- **Decision — object-level controls move out of the text toolbar.** *Card background colour* and *Delete note* are not text formatting. They stay in the existing `setFloatingToolbar` slot above the card, as a small separate chip (swatches + trash), shown while editing. (That slot is fine for card chrome; it is the wrong home for text formatting.)
- **Decision — reorder checklist items with `Alt+ArrowUp/Down`** (small ProseMirror command extension `lib/tiptap/task-item-move.ts`, in the shared list). Keeps children and `checked`; no-op at the ends. Drag-handle reordering **not included** — on this canvas drag is the most ambiguous gesture (`widget-interaction.ts`), and it is a separate interaction.
- **Decision — checkbox look** via theme variables in `.prose-note` and `.prose-page` (size, accent, hover, focus ring). No raw hex.
- **Assumption:** checklist creation/storage already works; the gap is discoverability (via `/`), reorder, styling, and test coverage. No new node type, no custom markdown syntax (GFM `- [ ]` / `- [x]` is the standard).
- **Assumption:** "view mode" = the note when not entered for editing; it renders checklist state read-only. Toggling a checkbox *without* entering the note is **out of scope** (body is `pointer-events-none` until entered by design — tracker bugs 2/12).
- **Assumption:** the always-visible wide toolbar is removed for notes. If you would rather keep a compact block-type row too, say so.
- **Assumption:** no schema/data migration; existing notes unchanged.
- **Rejected:** keeping one bar and just making it sticky inside the card (eats card height, still far from the caret); keeping the portal-pinned-to-card idea from draft v1 (still not near what you are typing); custom toolbar positioning maths (floating-ui in BubbleMenu already flips/shifts/clamps).

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `components/canvas/note-bubble-menu.tsx` | new — selection bubble (inline marks, colours, highlight, size) |
| `components/canvas/note-card-chip.tsx` | new — card background swatches + delete (extracted from `note-toolbar.tsx`) |
| `components/canvas/note-toolbar.tsx` | delete after its parts are split (or reduce to shared `ToolbarButton`) |
| `components/canvas/markdown-widget.tsx` | edit — render `BubbleMenu`; `setFloatingToolbar(<NoteCardChip/>)` |
| `lib/tiptap/slash-menu.tsx` | new — Suggestion-based `/` menu (items + list UI) |
| `lib/tiptap/task-item-move.ts` | new — `Alt+Up/Down` command extension |
| `lib/tiptap/note-extensions.ts` | edit — register slash menu + move extension |
| `app/globals.css` | edit — checkbox/task item styles, slash-menu styles (theme vars) |
| `tests/markdown-editor.test.ts` | edit — checklist cases |
| `tests/task-item-move.test.ts` | new |
| `tests/slash-menu.test.ts` | new — item commands apply the right nodes |

## Requirements

1. Selecting text in an edited note shows a bubble attached to the selection, wherever the selection is in the card (top, bottom, scrolled). It flips below / shifts sideways to stay fully on screen and never covers the selected text.
2. The bubble has constant screen size at any canvas zoom and is not clipped by the card.
3. Bubble buttons don't steal editor focus or collapse the selection; all marks/colours/highlight/size behave as before; existing keyboard shortcuts (Mod-B/I/U…) unchanged.
4. No bubble for an empty selection, a read-only note, or a view-only member.
5. Typing `/` at the start of an empty block (or after a space) opens a menu at the caret; arrow keys/Enter/Escape work; choosing Checklist converts the block to a task list; filtering by typing narrows the list.
6. Checklist: Enter adds an item, Enter on an empty item exits, clicking a checkbox while editing toggles it, Backspace removes an item, Tab/Shift-Tab nest/unnest.
7. `Alt+ArrowUp/Down` moves the current item among siblings with its children and `checked`; no-op at the ends.
8. `checked` state and order survive save + reload (JSON) and markdown export/import (`- [ ]` / `- [x]`, nested).
9. Card background colour and Delete note still work from the card chip.
10. Readable in dark (notes) and light (docs page); old notes render and edit as before.

## Data and schema

None. Widget `data` JSONB shape unchanged. No migration.

## Security

- No new route/action/entry point. Saves still go through `updateWidgetDataAction` (its `requireViewerContext` identity, `organizationId` scoping, `canWriteWidgets`).
- Bubble, slash menu and card chip mount only when `editing && canWrite`. No secrets, no rate-limit change.

## Client data flow

- No new query keys or mutations; edits use the existing debounced `updateWidgetData` (retried once, shared failure signal).
- Nothing new in localStorage.

## Acceptance criteria

- [ ] Select text at the bottom of a long note: bubble appears next to it.
- [ ] Select text in a note near the top edge of the screen: bubble flips below, stays on screen.
- [ ] Zoom 25% / 100% / 200%: bubble size constant.
- [ ] `/` menu creates a checklist; check, uncheck, reorder (Alt+Up/Down), delete items.
- [ ] Reload: order and checked states identical.
- [ ] Pasting `- [ ] a\n- [x] b` gives a checklist; `getMarkdown()` returns the same text.
- [ ] Card colour and delete work; old notes unchanged; view-only member sees no editing UI.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run` (known 2 pre-existing failures: `summary-parser`, `widget-resizable`)
- [ ] `timeout 150 npx next build`

## Manual test steps

1. `npm run dev` (port 3001), workspace as owner. Add a note, double-click to edit.
2. Type 30+ lines. Select a word at the very bottom: bubble appears above that word. Click Bold; selection and focus stay.
3. Pan the note so its top is at the top of the screen, select a word on the first line: bubble flips below the word.
4. Zoom to ~25% and ~200%, select text: bubble stays the same readable size.
5. On an empty line type `/`, type `check`, Enter: a checklist starts. Type three items; Enter on an empty item exits.
6. Check item 2. Caret in item 3, Alt+Up: it moves above item 2; checked state travels. Alt+Down moves back. Tab nests an item.
7. Wait for save, reload: same order and checks.
8. Paste markdown `- [ ] a` / `- [x] b` on the canvas: new note shows a checklist.
9. Card chip: change card colour; delete a test note.
10. Invited view-only member: no bubble, no chip, no slash menu; checklist visible.
11. Docs page (`/workspace/<slug>/docs/...`): `/` menu and checkbox styling look right on the light sheet.

## Follow-ups

- Toggle a checkbox without entering the note (needs a `widget-interaction.ts` decision).
- Drag-handle reordering of blocks/checklist items.
- Link button in the bubble (not asked for here).
