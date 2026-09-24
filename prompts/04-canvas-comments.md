# Canvas comment threads (issue #15, phase 2)

**Date:** 2026-09-24
**Branch:** `feature/canvas-comments` (off `feature/mentions-notifications` until PR #26 merges, then rebased on `main`)
**Status:** approved

## Goal

Figma-style comments anywhere on the canvas. A **comment button in the bottom dock, next to Landmarks**, drops a new comment pin at the **centre of the current view**. Each pin is a **thread**: a first comment plus replies, with `@mentions`. Pins are always visible as small avatar bubbles; clicking one opens its thread. Threads can be **resolved** (pin hides; a toggle shows resolved ones; replying reopens).

This covers the issue's scenario — *"a user comments … and mentions another person to ask whether the fix has been completed"* — on any part of the desk, not only board entries.

"Done" = any member, including a view-only invitee, can drop a pin, write a comment with `@mentions`, reply to others' threads, and the mentioned people plus everyone already in the thread get a bell notification that flies the canvas to that pin with its thread open.

## What I read

- `AGENTS.md`, `CLAUDE.md`, `.claude/context/progress-tracker.md`, `prompts/03-mentions-and-notifications.md`.
- `components/canvas/canvas-mode-toolbar.tsx` — bottom dock; "Section 5: Landmark Control" (`LocateIcon` button toggling the landmark search). The comment button goes beside it. Receives `addWidgetAtViewportCenter` from the shell.
- `components/canvas/canvas-shell.tsx` — `addWidgetAtViewportCenter` (`screenToFlowPosition` of the window centre), `handleFlowInit` (opening target: `?focus` → HOME landmark → fitView), the `?focus` fly-to effect, `nodeTypes = { widget }`.
- `components/canvas/hooks/use-widget-layout.ts` — `onNodesChange` turns every `position`/`dimensions` change into a **widget** save. Any non-widget node in that array would be "saved" as a widget.
- `components/canvas/draw-canvas-overlay.tsx` — precedent for a canvas-space layer that is NOT nodes: strokes render inside xyflow's `<ViewportPortal>`.
- `components/canvas/landmark-widget.tsx`, `lib/actions/landmarks.ts` — landmarks are a widget type + own table; widget rows need `canWriteWidgets`, so that model can't serve view-only commenters.
- `lib/permissions.ts`, `tests/workspace-permissions.test.ts` — all writes owner/admin today.
- `lib/notifications.ts` (`notify`, hardcoded mention dedupe key), `lib/mentions.ts`, `lib/tiptap/mention-suggestion.tsx`, `lib/tiptap/use-mention-suggestion.ts` — reused.
- `components/canvas/notification-bell.tsx` — `describe()` per kind; same-page links use `pushState`.
- `app/workspace/[slug]/page.tsx` — server prefetch wave pattern (`getDefaultLandmark`, `initialLandmarks`).
- `.claude/skills/react-flow` (`references/viewport.md`: `ViewportPortal`, `screenToFlowPosition`, `setCenter`), `.claude/skills/tanstack-query-best-practices` (optimistic updates, rollback, invalidation).

## Decisions and assumptions

User decisions (2026-09-24):
- **Anywhere on the canvas**, placed at the viewport centre from a dock button next to Landmarks.
- **Threads with replies** — flat list under the first comment (no nested replies).
- **Always visible** pins.
- **Resolve** hides a pin; a "Show resolved" toggle reveals them; any new reply reopens the thread.
- **Move:** the thread's author, or owner/admin, can drag a pin.
- **Free position:** a pin stores a canvas coordinate; it does not follow widgets.
- **`canComment`** includes `member` (view-only invitees) — decided in the phase 1 discussion.

Design:
- **Decision: pins are NOT widgets and NOT xyflow nodes.** Widget rows require `canWriteWidgets` (owner/admin), and every node in xyflow's array flows through `useWidgetLayout`'s widget-save path, marquee select and Delete-key removal. Pins get their own tables and render in a `<ViewportPortal>` layer (the draw overlay's precedent), so the widget model, the registry and its permission are untouched.
- **Decision: pin dragging is our own pointer handling** inside the portal: pointer-down on a pin you may move → track `movementX/Y ÷ zoom` → on release, one `moveCommentThreadAction`. A click without movement (< 4px) opens the thread instead. `stopPropagation` so xyflow doesn't pan.
- **Decision: placing a pin** = `screenToFlowPosition(window centre)` (same maths as `addWidgetAtViewportCenter`), which creates a **draft** pin locally with the composer open. Nothing is written until the first comment is posted; cancelling (Esc / empty blur) discards it. The thread row and first comment are created by **one** action.
- **Decision: the thread popover** opens beside its pin, rendered in screen space (portal to `document.body`, positioned from the pin's screen rect) so it does not scale with zoom. Contents: comments oldest-first (avatar with `no-referrer`, name, relative time, "edited", body with mention chips), per-comment Edit/Delete menu, Resolve/Reopen, Delete thread, and a reply composer.
- **Decision: composer** = small Tiptap editor, own minimal schema `createCommentExtensions()` (StarterKit with headings/lists/code block/blockquote/HR off, Placeholder, the same Mention). Stored as ProseMirror JSON, so `extractMentionIds` / `redactMentions` apply unchanged. Enter posts, Shift+Enter breaks the line. Rejected: textarea + regex `@name` (phase 1 rule: names aren't unique).
- **Decision: pin appearance** = round bubble with the thread author's avatar (initial fallback) and a reply-count badge; theme tokens only; fixed screen size (counter-scaled by `1/zoom` so it stays legible when zoomed out). Resolved pins, when shown, are dimmed.
- **Decision: who is notified**, all through `notify()`:
  1. people **newly mentioned** in a comment → `kind: "mention"`, `sourceType: "comment_thread"`;
  2. the **thread author and everyone who has commented in the thread** → `kind: "comment_reply"`;
  minus the commenter, minus anyone covered by (1) for the same comment. Editing a comment notifies only newly added mentions; never re-sends replies. Resolving/moving/deleting notifies nobody.
- **Decision: `notify()` takes `dedupeKey(recipientId)`** instead of hardcoding the mention key. Comment keys: `mention:comment:<commentId>:<recipient>`, `reply:comment:<commentId>:<recipient>`. Phase 1 callers pass `mentionDedupeKey` explicitly → identical keys, no behaviour change.
- **Decision: link** `/workspace/<slug>?thread=<threadId>`. Resolved in `handleFlowInit` (priority: `?thread` → `?focus` → HOME → fitView) from server-prefetched threads, then an effect handles same-page clicks; opens the popover (revealing it even if resolved); param stripped with `history.replaceState`.
- **Decision: permissions** — `canComment(role)` (all three roles) for creating threads and replying; editing a comment = its author only (enforced in the UPDATE's WHERE); deleting a comment = author or `canModerateComments` (= `canManageWorkspace`); resolve/reopen = any commenter (`canComment`); move a pin = thread author or `canModerateComments`; delete a whole thread = thread author or `canModerateComments`.
- **Decision: deletes are soft** (`deletedAt`) for both tables. Deleting the first comment of a thread with replies leaves the thread (the comment renders "Comment deleted"); deleting the last remaining comment deletes the thread. Deleting a thread hides it and its comments.
- **Decision: reads** — the workspace page prefetches the thread list (id, x, y, author, reply count, resolved) for first paint; the client keeps it in `useQuery(commentThreadsKey(slug))` with a 60s `refetchInterval` + focus refetch so teammates' new pins appear without reload (same cadence as the bell). A thread's comments load on open via `useQuery(commentThreadKey(threadId))`.
- **Decision: writes** are server actions in `lib/actions/comments.ts`, rate-limited with `checkRateLimit` (create/reply/edit/delete/resolve) and `checkDragRateLimit` (move).
- **Decision:** new tables use `timestamptz`.
- **Assumption:** comment text 1–5 000 characters (measured on extracted text), body JSON ≤ 64 KB; max 200 open threads per workspace (cheap guard, like `MAX_WIDGETS_PER_WORKSPACE`).
- **Assumption:** pins are hidden while in `draw` / `laser` mode (they would steal pointer events) and shown in `grab` / `select`. The comment button switches to `grab` if a drawing tool is active.
- **Assumption:** the public share page, the IDE window and the MCP server are unaffected in this phase.
- **Rejected:** comments only on board entries (previous draft — user clarified they belong on the whole canvas).
- **Rejected:** a `comment` widget type in the registry — forces `canWriteWidgets`, and pins would be selectable/deletable/resizable like widgets.
- **Rejected:** attaching pins to widgets — user chose free position.
- **Rejected:** Tiptap's Comments extension (Pro, Tiptap Cloud).

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `lib/db.ts` | `comment_threads`, `comments` tables (timestamptz), register |
| `drizzle/migrations/0019_*.sql` | generated |
| `lib/permissions.ts` | `canComment`, `canModerateComments` |
| `lib/notifications.ts` | `dedupeKey` fn on `NotifyInput`; kind `comment_reply`; source `comment_thread`; `threadHref`, comment dedupe-key builders |
| `lib/actions/widgets.ts`, `lib/actions/docs.ts` | pass `mentionDedupeKey` explicitly (no behaviour change) |
| `lib/comments.ts` | new, pure — body validation, reply-recipient computation, drag/click threshold |
| `lib/actions/comments.ts` | new — `listCommentThreadsAction`, `getCommentThreadAction`, `createCommentThreadAction`, `replyToThreadAction`, `updateCommentAction`, `deleteCommentAction`, `setThreadResolvedAction`, `moveCommentThreadAction`, `deleteCommentThreadAction` |
| `lib/tiptap/comment-extensions.ts` | new — minimal schema + Mention |
| `components/canvas/comments/comment-layer.tsx` | new — `<ViewportPortal>` pin layer, drag, draft pin |
| `components/canvas/comments/comment-pin.tsx` | new — bubble |
| `components/canvas/comments/comment-thread-popover.tsx` | new — thread, replies, resolve, menus |
| `components/canvas/comments/comment-composer.tsx` | new — Tiptap composer |
| `components/canvas/canvas-mode-toolbar.tsx` | comment button + "Show resolved" toggle beside Landmarks |
| `components/canvas/canvas-shell.tsx` | mount layer; `?thread` in `handleFlowInit` + effect; place-at-centre callback |
| `app/workspace/[slug]/page.tsx`, `components/workspace-dashboard.tsx` | prefetch threads; pass `canComment`, viewer id |
| `components/canvas/notification-bell.tsx` | `describe()` for `comment_reply` and comment mentions |
| `lib/query-keys.ts` | `commentThreadsKey(slug)`, `commentThreadKey(threadId)` |
| `tests/comments.test.ts` | new — validation, recipients, dedupe keys, drag threshold |
| `tests/workspace-permissions.test.ts` | extend — `canComment`, `canModerateComments` |
| `tests/comment-extensions.test.ts` | new — schema allows paragraph/bold/mention, drops headings/tables |

## Requirements

1. The dock shows a comment button beside Landmarks (tooltip "Add comment"), for every role.
2. Clicking it places a draft pin at the centre of the current view with the composer open and focused; Esc or leaving it empty discards the draft.
3. Posting the first comment creates the thread; the pin stays where it was placed and shows the author's avatar.
4. Pins are always visible in grab/select mode, stay the same on-screen size at any zoom, and show a reply count when there are replies.
5. Clicking a pin opens its thread: comments oldest-first with avatar, name, relative time, "edited" marker and mention chips; a reply composer with the `@` picker.
6. Any member (including view-only) can create threads and reply. Replies appear immediately (optimistic) and roll back with a toast on failure.
7. Edit is offered only on your own comments; Delete on your own, or on anyone's for owner/admin.
8. Resolve hides the pin for everyone; "Show resolved" in the dock reveals resolved pins dimmed; replying to a resolved thread reopens it.
9. The thread author and owner/admin can drag a pin; the new position persists and appears for others on their next refresh (≤60s). Others cannot drag it (click still opens it).
10. Mentioning B in a comment gives B one `mention` notification ("A mentioned you in a comment").
11. Replying notifies the thread author and every previous commenter once ("A replied to a comment thread"), excluding the replier and anyone mentioned in that same reply.
12. Editing a comment to add a mention notifies only the new person.
13. Clicking a comment notification flies the canvas to the pin and opens its thread — on a cold load and on the same page — even if the thread is resolved.
14. A thread or comment id from another workspace behaves exactly like a missing one; all writes are rate-limited with a readable error.
15. Widgets, the registry, the share page, the IDE window and MCP behave exactly as before.

## Data and schema

`comment_threads`:

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `organization_id` | text not null → organization, cascade | |
| `author_id` | text null → user, set null | |
| `x`, `y` | integer not null | canvas coordinates |
| `resolved_at` | timestamptz null | |
| `resolved_by` | text null → user, set null | |
| `deleted_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz not null default now() | |

Index `(organization_id) where deleted_at is null`.

`comments`:

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `thread_id` | uuid not null → comment_threads, cascade | |
| `organization_id` | text not null → organization, cascade | denormalised so every query scopes by org without a join |
| `author_id` | text null → user, set null | |
| `body` | jsonb not null | ProseMirror JSON (comment schema) |
| `edited_at`, `deleted_at` | timestamptz null | |
| `created_at` | timestamptz not null default now() | |

Index `(thread_id, created_at, id)`.

Additive only. Neon HTTP has no transactions, so `createCommentThreadAction` inserts the thread, then the first comment; if the second insert fails it soft-deletes the thread it just made and returns the error (no orphan pin). `npx drizzle-kit generate` → `npm run db:migrate`.

## Security

- **Identity:** every action calls `requireViewerContext()`.
- **Scoping:** every query filters `organization_id = viewer.organizationId` (both tables) and `deleted_at is null`; a comment write also requires its thread to be live in the same org. Foreign ids → "not found".
- **Writes:** `canComment` for create/reply/resolve; author-only edit in the UPDATE's WHERE; delete/move/delete-thread = author OR `canModerateComments`. No inline role checks.
- **Content:** Zod + `lib/comments.ts` validation server-side (shape, JSON ≤ 64 KB, text 1–5 000 chars); rendered by read-only Tiptap, never as an HTML string. Coordinates validated as finite integers within ±10 000 000.
- **Notifications:** all via `notify()` (membership re-check, actor excluded, fan-out cap 20, unique dedupe key). Reply recipients are read from the DB, never taken from the client.
- **Rate limiting:** `checkRateLimit("comment:<userId>")` for deliberate actions, `checkDragRateLimit("comment-move:<userId>")` for moves.
- **Public share page:** unaffected — threads are canvas-only and never serialized there.

## Client data flow

- `commentThreadsKey(slug)` — workspace-scoped (the list is per workspace, static key otherwise); seeded from server prefetch via `initialData`; `refetchInterval: 60_000`, focus refetch. Excluded from persistence (it's live collaborative state; a stale persisted copy would flash deleted pins).
- `commentThreadKey(threadId)` — thread id is globally unique, no slug needed; fetched while the popover is open.
- Mutations: create thread / reply / edit / delete / resolve / move — optimistic `setQueryData` on the affected key(s) with rollback context; `onSettled` invalidates `commentThreadsKey(slug)` and the thread's key. `unwrapAction()` on every call; `mutate` destructured.
- `@` picker reuses `useMentionSuggestion(slug, canComment)`.

## Acceptance criteria

- [ ] Dock button places a draft pin at view centre; post creates the thread (R1–R3).
- [ ] Pins visible, zoom-stable, reply count (R4); thread popover per R5.
- [ ] View-only member can create and reply; optimistic + rollback (R6); edit/delete visibility and server enforcement (R7).
- [ ] Resolve / show resolved / reopen-on-reply (R8); drag permissions + persistence (R9).
- [ ] Mention, reply and edit notifications exactly per R10–R12, no duplicates on retry.
- [ ] Notification click flies to and opens the thread, cold and same-page, resolved or not (R13).
- [ ] Cross-workspace ids → not found; rate limits (R14); nothing else changed (R15).
- [ ] Unit tests: permissions, validation, recipients, dedupe keys, drag threshold, comment schema.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run`
- [ ] `timeout 150 npx next build`
- [ ] `npx drizzle-kit generate` + `npm run db:migrate`

## Manual test steps

Two browsers, `npm run dev` on 3001. A = owner of W, B = view-only member, C = another member.

1. B pans somewhere, clicks the comment button (beside Landmarks) → a draft pin appears in the middle of the view with the composer focused. Press Esc → it disappears, nothing saved.
2. B clicks again, types "is this fixed? @A", Enter → pin with B's avatar stays at that spot.
3. A (≤60s / refocus): the pin appears; bell shows "B mentioned you in a comment". Click it → canvas flies to the pin, thread open.
4. A replies "yes, deployed" → B's bell: "A replied to a comment thread" (one notification). B's pin shows reply count 1.
5. C replies without mentions → A and B each get exactly one reply notification.
6. B edits the first comment to add `@C` → C gets one mention; nobody else gets anything new.
7. C tries to drag B's pin → it doesn't move (click opens it). B drags it → new spot persists after reload. A (owner) can also drag it.
8. A resolves the thread → pin disappears for everyone. Toggle "Show resolved" → dimmed pin appears. C replies → thread reopens, pin back for everyone.
9. B deletes their own comment; A deletes C's comment as owner; C cannot see Delete on others' comments.
10. Zoom far out and in → pins stay the same on-screen size. Switch to Pen → pins hidden; back to Grab → visible.
11. Light and dark mode → pins, popover, chips and composer readable.

## Follow-ups

- Attach pins to widgets (user chose free position for now).
- Comments on the public share page / doc pages; MCP tools to read and post comments.
- Real-time push instead of 60s polling, if polling feels slow.
- Phase 3: email delivery, preferences, unsubscribe — `mention` and `comment_reply` are the first two email kinds.
