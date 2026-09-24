# Mentions and in-app notifications (issue #15, phase 1)

**Date:** 2026-09-24
**Branch:** `feature/mentions-notifications`
**Status:** approved

## Goal

GitHub issue #15 asks for @mentions plus in-app and email notifications, with a delivery model future AI alerts can reuse. The user split it into three phases; this prompt is **phase 1 only**:

- An `@` in a canvas note (markdown widget) or a docs page opens a member picker; picking inserts a mention chip that resolves to a user id, not plain text.
- Saving content that newly mentions a workspace member creates exactly one in-app notification for that member.
- A bell in the canvas chrome shows the unread count and a list; clicking an item opens the source and marks it read.
- One server-side `notify()` is the only way a notification row is written, so phase 2 (comments) and later AI alerts reuse it unchanged.

"Done" = a teammate mentioned in a note sees a badge on the bell within a minute, clicks it, and lands on that note.

## What I read

- `AGENTS.md`, `CLAUDE.md`, `.claude/context/progress-tracker.md`
- GitHub issue #15 (`gh issue view 15`) — scope, acceptance criteria.
- `lib/permissions.ts` — only `view` invites exist; every write predicate is owner/admin. Mention *authors* are therefore owner/admin today; *recipients* can be any member.
- `lib/actions/widgets.ts` — `updateWidgetDataAction` is the markdown widget's save path (drag limiter, 500ms debounce upstream). It writes `data` blindly; no read of the previous value.
- `lib/actions/docs.ts` — `updateDocPage(id, { content })` is the docs save path, gated by `canWriteEntries`, org-scoped through `getDocProject`.
- `lib/tiptap/note-extensions.ts` — the single extension list for both editors, and the schema. A mention node must be added here or it is silently dropped.
- `components/canvas/markdown-widget.tsx` — stores `{ content: editor.getJSON(), bgColor }`.
- `components/docs/tiptap-editor.tsx`, `components/docs/docs-project-view.tsx` — doc page save through `updateDocPage`.
- `lib/actions/members.ts` — `getWorkspaceMembersData` returns members + (for managers) invitations; heavier than a picker needs.
- `lib/workspace.ts` — `requireViewerContext`, `getMemberRole`.
- `lib/query-keys.ts` — workspace-scoped key convention.
- `app/providers.tsx` — persister with `shouldDehydrateQuery` exclusion list (board excluded).
- `app/workspace/[slug]/page.tsx` — visiting a slug sets it as the active organization, so a notification link can target another workspace safely.
- `app/workspace/[slug]/docs/[projectId]/page.tsx` — no page-selection param today.
- `components/canvas/canvas-chrome.tsx` — top chrome with the user menu; the bell goes here. **Note:** this file has an uncommitted local change in the working tree — I will not touch that hunk.
- `lib/email.ts` — SMTP mailer exists; not used in this phase.
- `lib/db.ts` — `widgets` shape, existing columns use `timestamp` without time zone; migrations up to `0017`.
- `components/canvas/canvas-shell.tsx` — `handleFlowInit` (onInit) already decides the opening viewport (default landmark → `setCenter`, else `fitView`). Its comment records that doing this in a mount effect **raced xyflow's own fitView and lost**. `flyToLandmark` shows the `measured ?? width ?? 150` centring pattern.
- Project skills (`.claude/skills/`, installed this session):
  - `tiptap` — pin every `@tiptap/*` package to one version line; verify against source/docs, don't guess.
  - `react-flow` (`references/viewport.md`) — `setCenter` on a node's centre; use viewport methods only once initialised.
  - `tanstack-query-best-practices` — hierarchical key factory, `mut-invalidate-queries`, `inf-max-pages`, `inf-loading-guards`, `persist-queries`.
  - `drizzle-orm-patterns`, `neon-postgres`, `shadcn`, `vercel-react-best-practices` — skimmed; nothing contradicts the existing repo patterns.
- Package sources verified with `npm pack`:
  - `@tiptap/extension-mention@3.30.1` — peer-pins `@tiptap/core`/`pm`/`suggestion` **exactly** `3.30.1` (latest `3.31.3` would require bumping every tiptap package). Ships a built-in markdown spec (`createInlineMarkdownSpec`, attrs `id`, `label`), so mentions survive markdown round-trips with their id.
  - `@tiptap/suggestion@3.30.1` — supports managed popup positioning via `props.mount(element)`; has `@floating-ui/dom ^1` as a **peer** dependency (present only transitively via `@base-ui/react` today).
- Tiptap docs: `editor/extensions/nodes/mention.md`, `editor/api/utilities/suggestion.md`.

## Decisions and assumptions

- **Decision (user):** Phase 1 only. Comments = phase 2, email/preferences/unsubscribe = phase 3.
- **Decision (user):** new tables use `timestamptz`. Existing tables are untouched; the global migration stays an open question.
- **Decision (user, for phase 2):** a `canComment` predicate that includes `member` will be added in phase 2. Nothing in this phase changes who can write.
- **Decision:** use the official `@tiptap/extension-mention` + `@tiptap/suggestion`, both pinned **exactly** to `3.30.1` (the repo's tiptap line), plus `@floating-ui/dom` as a direct dependency because it is suggestion's peer. No tiptap version bump in this change. Node attrs: `id` (userId), `label` (display name snapshot at insert time). Markdown uses the extension's built-in inline spec, which keeps `id` and `label`, so a markdown round trip does not lose the user.
- **Decision:** the suggestion popup follows the documented default: `ReactRenderer` + `props.mount(component.element)` (managed floating-ui positioning), with `floatingUi.strategy: "fixed"` so it isn't clipped by the canvas's transformed/overflow-hidden widget. The editors keep the existing `useEditor` + `<EditorContent>` API — each lives in one component, and switching to the Composable API is out of scope.
- **Known edge:** the built-in markdown serializer does not escape `"` inside `label`. Server-side extraction reads ProseMirror JSON, never markdown, so ids are unaffected; a test pins what happens to a name with a quote.
- **Decision:** the picker source is a new lightweight action `listMentionableMembersAction()` returning `{ id, name, image }[]` for the active workspace, fetched once per workspace and filtered client-side. Workspaces are small; a per-keystroke server search is not worth it.
- **Decision:** dedupe is two layers.
  1. The save action reads the previous content, computes `added = mentions(next) − mentions(prev)`, and only calls `notify()` for `added`. Avoids work on every keystroke save.
  2. `notifications.dedupe_key` is unique and the insert is `ON CONFLICT DO NOTHING`. Key for mentions: `mention:<sourceType>:<sourceId>:<recipientId>`. This is what makes concurrent saves, the widget-save retry, and Neon's lack of transactions safe.
  Consequence: a person is notified **once per source** for a mention, ever. Removing and re-adding them does not re-notify. Deliberate — spam-safe; revisit if users ask.
- **Decision:** `notify()` re-checks every recipient is a current member of the organization (one query) and drops the author themself. Unknown/removed/deleted ids are silently dropped — the chip stays in the content with its snapshot label.
- **Decision:** the bell lists the viewer's notifications from **all** workspaces they are still a member of (joined against `member` at read time), each labelled with the workspace name. A notification from a workspace the user has left is hidden, not deleted.
- **Decision:** reads poll — unread count via `useQuery` with `refetchInterval: 60_000` and refetch on window focus. No websockets/SSE.
- **Decision:** notification queries are per-user, not per-workspace, and are **excluded from persistence** (added to the `shouldDehydrateQuery` exclusion alongside the board), so a second account on the same browser never hydrates the first account's list.
- **Decision:** the model is generic for later phases: `actorType` (`user` | `system` | `ai`), `actorId` nullable, `kind` (`mention` now; the TypeScript union is where `comment_reply`/`ai_alert` get added), `sourceType` + `sourceId`, `payload` jsonb (snippet, titles, link). The link is computed server-side into `payload.href` so the client never builds URLs from ids.
- **Decision:** link targets.
  - Markdown widget → `/workspace/<slug>?focus=<widgetId>`. The target is resolved **inside `handleFlowInit`**, never in a mount effect (that race is already recorded in the file). Priority: focus node → default landmark → `fitView`. It centres with `instance.setCenter` using the same `measured ?? width ?? 150` maths as `flyToLandmark`, then strips the param with `router.replace`. If the canvas is already mounted (clicking a notification for the workspace you're on), the bell navigates, and a `useSearchParams` change calls the existing `setCenter` path, the same way `flyToLandmark` does for search.
  - Doc page → `/workspace/<slug>/docs/<projectId>?page=<pageId>`; the docs view selects that page on mount if it exists.
- **Assumption:** only markdown widgets and doc pages get mentions in this phase. Board entries (plain text title/summary), bookmarks, and the code card do not.
- **Assumption:** mentions inserted over MCP are out of scope; MCP tools are unchanged.
- **Assumption:** at most 20 new recipients are notified per save (excess ignored) — cheap guard against a pasted wall of mentions.
- **Rejected:** parsing `@name` plain text server-side. Names are not unique and change; the id-carrying node is the only reliable source.
- **Rejected:** notifications written from the client or a route handler. The save actions already hold identity, org scope and the write check; notify runs inside them.
- **Rejected:** Tiptap's Comments extension (which the `tiptap` skill recommends for comments). It is a Pro extension backed by Tiptap Cloud: a paid external service holding workspace content, and a second tenancy model. Phase 2 comments will be our own table behind `canComment`.
- **Rejected:** bumping all tiptap packages to `3.31.3` to take the latest mention. That's an unrelated upgrade across both editors; do it separately if wanted.
- **Rejected:** creating `notification_preferences` / `email_outbox` now. They belong to phase 3, where their shape is driven by the email work; creating them empty now just guesses.

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `package.json` / lockfile | add `@tiptap/extension-mention@3.30.1`, `@tiptap/suggestion@3.30.1` (exact), `@floating-ui/dom@^1` |
| `lib/db.ts` | new `notifications` table (timestamptz), export |
| `drizzle/migrations/0018_*.sql` | generated |
| `lib/mentions.ts` | new — pure `extractMentionIds(doc)`, `diffMentions(prev, next)` |
| `lib/notifications.ts` | new — server-only `notify(inputs[])`, kind/actor types, dedupe-key builders, href builders |
| `lib/actions/notifications.ts` | new — `listNotificationsAction(cursor?)`, `getUnreadNotificationCountAction()`, `markNotificationsReadAction(ids \| "all")` |
| `lib/actions/members.ts` | add `listMentionableMembersAction()` |
| `lib/actions/widgets.ts` | `updateWidgetDataAction`: for `markdown` widgets, read prev data, diff, `notify` in `after()` |
| `lib/actions/docs.ts` | `updateDocPage`: when `patch.content` present, read prev content, diff, `notify` in `after()` |
| `lib/tiptap/note-extensions.ts` | add configured `Mention` with suggestion render + markdown render |
| `lib/tiptap/mention-suggestion.tsx` | new — suggestion popup (portal, keyboard nav) |
| `components/notifications/notification-bell.tsx` | new — bell, badge, popover list, mark-read |
| `components/canvas/canvas-chrome.tsx` | mount the bell (outside the uncommitted hunk) |
| `components/canvas/canvas-shell.tsx` | read `?focus=` once, `fitView` that node |
| `components/docs/docs-project-view.tsx` | honour `?page=` on mount |
| `lib/query-keys.ts` | `mentionableMembersKey(slug)`; notification keys (per-user, documented why not workspace-scoped) |
| `app/providers.tsx` | exclude notification keys from persistence |
| `app/globals.css` | `.mention` chip style from theme vars |
| `tests/mentions.test.ts` | new |
| `tests/notifications.test.ts` | new — dedupe keys, recipient filtering (pure parts) |
| `tests/note-extensions*.test.ts` | extend: mention node survives the JSON and markdown round trip; pin the behaviour when a label contains `"` |

## Requirements

1. Typing `@` in a canvas note or doc page (as owner/admin) opens a picker listing active-workspace members, filtered by typed text, navigable with ↑/↓/Enter/Esc.
2. Selecting inserts an inline, atomic mention chip showing `@Name`, styled from theme variables, readable in light and dark.
3. The chip's persisted JSON is `{ type: "mention", attrs: { id: <userId>, label: <name> } }`, and it survives a JSON → markdown → JSON round trip with `id` intact.
3a. Pasting markdown that contains a mention shortcode for a non-member produces a chip but no notification (R7 covers it server-side).
4. View-only members see chips rendered read-only; the picker never opens for them (editor is not editable).
5. Saving a note/page that newly contains a mention of member B (≠ author) creates one `notifications` row for B with `kind = "mention"`, correct `organizationId`, `sourceType`, `sourceId`, and `payload.href`.
6. Re-saving the same content, the debounced saves while typing, and the save retry create no additional rows for B.
7. Mentioning a non-member id, a removed member, or yourself creates no row and does not fail the save.
8. Notification work never fails or delays the save: it runs in `after()`, and its errors are logged, not returned.
9. The bell shows the unread count (hidden at 0, `9+` above 9) and refreshes within 60s and on window focus.
10. The bell popover lists newest-first, paginated by cursor: actor name/avatar (or "Someone" if the actor was deleted), "mentioned you in <note/page title>", workspace name, relative time, unread dot.
11. Clicking an item marks it read and navigates to `payload.href`; "Mark all read" clears the badge.
12. Opening `/workspace/<slug>?focus=<widgetId>` centres that widget; an unknown id is ignored.
13. Opening a doc with `?page=<pageId>` selects that page; an unknown id falls back to the default page.
14. Notifications from a workspace the user is no longer a member of do not appear and do not count.
15. Deleting a user removes notifications addressed to them (FK cascade) and nulls `actorId` on ones they caused.

## Data and schema

New table `notifications`:

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk default random | |
| `organization_id` | text not null → `organization.id` on delete cascade | |
| `recipient_id` | text not null → `user.id` on delete cascade | |
| `actor_type` | text not null | `user` \| `system` \| `ai` |
| `actor_id` | text null → `user.id` on delete set null | |
| `kind` | text not null | `mention` (phase 1) |
| `source_type` | text not null | `widget` \| `doc_page` |
| `source_id` | text not null | widget `id` or doc page id |
| `payload` | jsonb not null | `{ href, title, snippet? }` |
| `dedupe_key` | text not null unique | |
| `read_at` | timestamptz null | |
| `created_at` | timestamptz not null default now() | |

Indexes: `(recipient_id, created_at desc)`, partial `(recipient_id) where read_at is null` for the count.

Existing rows: none affected. Migration is additive. `npx drizzle-kit generate` then `npm run db:migrate`.

## Security

- **Identity:** every new action calls `requireViewerContext()`. `notify()` is server-only (not exported from a `"use server"` file), so the client cannot call it with an arbitrary recipient.
- **Scoping:** `notify()` takes `organizationId` from the viewer, never from content. Recipients are intersected with `member` rows of that org. The notification list filters `recipient_id = viewer.userId` and joins `member` so left workspaces are hidden. `markNotificationsReadAction` updates only rows where `recipient_id = viewer.userId` — another user's id is indistinguishable from a missing one.
- **Writes:** mentions are only produced through saves already gated by `canWriteWidgets` / `canWriteEntries`. Marking read is the recipient's own row, so it needs no role predicate — but it still requires a session.
- **Member list exposure:** `listMentionableMembersAction` returns only id, name, image of the viewer's active workspace — no emails. Any member can see who else is a member today already, so this exposes nothing new.
- **Content injection:** the `label` attr is rendered as text by ProseMirror/React, never as HTML. `payload.snippet` is plain text trimmed to 140 chars, rendered as text.
- **Rate limiting:** saves keep their existing limiter (`checkDragRateLimit`). `markNotificationsReadAction` uses `checkRateLimit("notifications-read:<userId>")`. The 20-recipient cap bounds fan-out per save.
- **Secrets:** none involved.

## Client data flow

- `mentionableMembersKey(slug)` — `useQuery`, `staleTime` 5 min; persisted (workspace-scoped, harmless).
- `notificationsCountKey()` = `["notifications", "count"]`, `notificationsListKey()` = `["notifications", "list"]` — per-user, **excluded from persistence**.
- `useMutation(markNotificationsRead)` → `invalidateQueries({ queryKey: ["notifications"] })`.
- Keys come from one hierarchical factory in `lib/query-keys.ts` (`notificationKeys.all = ["notifications"]`, `.count()`, `.list()`), so the single `invalidateQueries({ queryKey: notificationKeys.all })` covers both.
- The list uses `useInfiniteQuery` with a `(createdAt, id)` cursor, `enabled` only while the popover is open, and `maxPages: 5`. "Load more" is guarded by `hasNextPage && !isFetchingNextPage`.
- Every action call wrapped in `unwrapAction()`; `mutate` destructured, never the mutation object in a dependency array.

## Acceptance criteria

- [ ] `@` in a note and a doc page opens a member picker; selection inserts a chip (R1–R3).
- [ ] View-only member sees chips, cannot open the picker (R4).
- [ ] Mentioning B creates exactly one row, even after many autosaves (R5–R6).
- [ ] Self/non-member mentions create nothing; the save still succeeds (R7–R8).
- [ ] B's bell shows the badge within 60s / on focus; list renders correctly (R9–R10).
- [ ] Click → marked read → lands on the focused widget or selected page (R11–R13).
- [ ] After B is removed from the workspace, the notification disappears from B's bell (R14).
- [ ] Unit tests cover mention extraction, diffing, dedupe key, and the mention round-trip.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run`
- [ ] `timeout 150 npx next build`
- [ ] `npx drizzle-kit generate` + `npm run db:migrate`

## Manual test steps

Two browsers (or one normal + one incognito), `npm run dev` on port 3001.

1. Browser A: sign in as **owner** of workspace W. Invite user B (view) and accept in Browser B.
2. A: on the canvas, create a note, type `@`, pick B. Chip `@B` appears. Keep typing a few seconds (several autosaves).
3. B: within 60s (or refocus the tab) the bell shows `1`. Open it: "A mentioned you in Note", workspace W.
4. B: click it → canvas centres on that note, badge clears.
5. A: delete and re-type the same mention, save → B's count stays at 0.
6. A: in a doc project, open a page, mention B. B gets a second notification; clicking opens that doc on that page.
7. A: mention yourself → A's bell stays unchanged.
8. B: try typing `@` in the note — editor is read-only, no picker.
9. A: remove B from W. B refreshes → both notifications gone, badge 0.
10. Toggle dark mode — chip, bell badge and popover readable in both.

## Follow-ups

- **Phase 2:** comments on board entries (and later widgets/doc pages), `canComment` predicate including `member`, mentions in comments, `comment_reply` kind — reuses `notify()`.
- **Phase 3:** `notification_preferences`, `email_outbox` + cron sweep (Hobby cron is daily → `after()` sends immediately, cron only retries), templates in `lib/emails/`, signed unsubscribe route, settings page.
- AI alerts: call `notify({ actorType: "ai", kind: "ai_alert", ... })` once a producer exists.
- "Once per source" dedupe means re-mentions don't re-notify — revisit if requested.
- Mentions in board entry summaries / via MCP — not planned yet.
