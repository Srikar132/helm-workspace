# Mention name resolution and notification delivery (issue #29)

**Date:** 2026-10-09
**Branch:** `fix/mention-resolution-29` (off `main`)
**Status:** shipped (not committed)

## Goal

GitHub issue #29, "Fix comment mention notifications and incorrect user resolution", plus the user's own report: a mention in a comment shows `@someone` instead of the person's name.

Done means:
- A mention always shows the mentioned member's *current* name, resolved from the stored user id. It never shows `@someone` for a member who is still in the workspace.
- A mentioned member gets an in-app notification and, per their preferences, an email.
- Nobody else gets notified.
- Tests cover mention resolution and both channels.

## What I read

- `AGENTS.md`, `CLAUDE.md` (it is just `@AGENTS.md`), `prompts/README.md`, `prompts/TEMPLATE.md`
- `.claude/context/progress-tracker.md` — only grepped for mention/notification decisions (lines 102-146): ids, not `@name` text, decide who is notified; dedupe is the unique `dedupe_key`; the public share page redacts mentions server-side.
- Files inspected:
  - `lib/mentions.ts` — `extractMentionIds` reads `attrs.id` of `mention` nodes only. `docSnippet` prints `@label`. `redactMentions` swaps mentions for `@teammate` on the public page.
  - `components/canvas/comments/comment-body.tsx` — renders a mention as `@{attrs.label}` and falls back to the hardcoded `"someone"` when `label` is not a string. This is where `@someone` comes from.
  - `lib/tiptap/mention-suggestion.tsx` — the picker calls `command({ id, label: item.name })`, so `label` is a snapshot of the name at write time.
  - `lib/tiptap/comment-extensions.ts`, `lib/tiptap/note-extensions.ts` — both use the stock Tiptap `Mention` node. In the installed `@tiptap/extension-mention`, `label` is a declared attribute, so it is serialized to JSON whenever it is set.
  - `lib/tiptap/use-mention-suggestion.ts`, `lib/actions/members.ts` (`listMentionableMembersAction`, workspace-scoped, id/name/image only) — an existing cached member list I can reuse for resolution.
  - `lib/actions/comments.ts` — `notifyForNewComment` (in `after()`), `updateCommentAction` (`diffMentions` then `notifyNewMentions`).
  - `lib/notifications.ts` — `notify()` drops the actor, dedupes, keeps only current members, inserts rows, then queues and delivers email. It swallows every error with `console.error`.
  - `lib/notification-email.ts`, `lib/email-unsubscribe.ts` — outbox rows, skip reasons, send; with no email key a row stays `pending` until the daily cron.
  - `components/canvas/notification-bell.tsx` — builds "X mentioned you in Y" from `actorName`.
  - Existing tests: `tests/mentions.test.ts`, `tests/notifications.test.ts`, `tests/email-notifications.test.ts`, `tests/comments.test.ts`.

## Decisions and assumptions

- **Decision:** the stored `id` stays the source of truth. At render time a mention shows the current member name looked up by id, falling back to the stored `label`, then to `@teammate` (not `@someone`). Fixes both the missing-label case and the renamed-user staleness.
- **Decision:** reuse `listMentionableMembersAction` through the existing `mentionableMembersKey(slug)` query rather than adding a new action or query.
- **Decision:** do not rewrite stored comment JSON (no migration or backfill). Resolution at render time covers old and new rows.
- **Assumption (unverified):** I have not reproduced the missing notifications. The save path in `lib/actions/comments.ts` and `notify()` read correctly, so step 1 of the work is to reproduce and find the actual cause. Candidates, most likely first:
  1. `notify()` swallows errors, so a failing insert is invisible (for example the DB, a constraint, or `after()` not completing).
  2. The bell's unread-count query is cached or persisted and never refetches while the tab is open.
  3. Email: no email key configured in the environment, so outbox rows stay `pending` until the daily cron (this is by design, but looks like "no email").
  4. The mentioned user's per-kind email preference is off.
  5. The mention node saved without an `id` (the picker was not used), so `extractMentionIds` returns nothing.
  I will fix whichever the reproduction confirms and report the rest as ruled out. I will not change delivery behaviour on a guess.
- **Assumption:** "Mentioned users receive an email ... according to their preferences" is already the designed behaviour (`queueNotificationEmails` + `disabledKinds`); only a defect in it is in scope.
- **Rejected:** parsing plain `@name` text to find mentions. Names are neither unique nor stable (already recorded in the tracker).
- **Rejected:** snapshotting the name at write time as the display source. It is the cause of the stale-name symptom.

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `lib/mentions.ts` | edit — add a pure `resolveMentionLabel(attrs, nameById)` (current name, else stored label, else `teammate`) |
| `components/canvas/comments/comment-body.tsx` | edit — take a name lookup, use `resolveMentionLabel`, drop the `"someone"` fallback |
| `components/canvas/comments/comment-thread-panel.tsx` | edit — read the cached member list and pass the lookup into `CommentBody` |
| `lib/tiptap/*` and note/doc mention chips | edit only if reproduction shows the same stale or missing label there |
| `lib/notifications.ts`, `lib/actions/comments.ts`, `lib/notification-email.ts` | edit only where the reproduction finds the delivery defect; at minimum log failures with enough context to diagnose |
| `tests/mentions.test.ts` | edit — `resolveMentionLabel` cases |
| `tests/notifications.test.ts`, `tests/email-notifications.test.ts` | edit — comment-mention path produces an in-app row for the right recipient only, and an outbox row unless disabled |
| `.claude/context/progress-tracker.md` | edit — record the outcome and the confirmed cause |

No migration, no `.env.example` change expected.

## Requirements

1. A comment mention displays the member's current workspace name, looked up by stored id.
2. If the member list has not loaded, or the id is not a current member, it shows the stored `label`; if that is also missing it shows `@teammate`. `@someone` no longer appears.
3. Renaming a user changes how existing mentions of them display, with no data rewrite.
4. A new comment or reply that mentions member B creates exactly one `mention` notification for B and none for anyone else (not the author, not unmentioned members, not another workspace).
5. B gets one outbox email row for it unless B switched off mention emails, and it is delivered when email is configured.
6. Editing a comment to add a mention notifies only the newly added person.
7. The confirmed cause of the missing notifications is stated in the closing report, with the evidence.

## Data and schema

None. Existing comment JSON is read as is.

## Security

- No new entry point. Reads go through `listMentionableMembersAction` (`requireViewerContext`) and returns only id, name and avatar of the active workspace's members.
- Notification writes keep their current scoping: `notify()` joins `member` on the actor's `organizationId`, so an id from another workspace is dropped.
- Writes stay gated by `canComment`; rate limiting unchanged (`checkRateLimit` per user).
- The public share page keeps `redactMentions`; this change does not touch it.
- No secret involved.

## Client data flow

- Reuses `mentionableMembersKey(slug)` (workspace-scoped). No new keys.
- No new mutation, so no new invalidation. The comment panel only reads the cached list.
- Nothing new is persisted to localStorage.

## Acceptance criteria

- [ ] No `@someone` anywhere in `components/` or `lib/`.
- [ ] A mention in an existing comment shows the user's current name after a rename.
- [ ] B receives an in-app notification and (email configured, preference on) one email for a comment that mentions B.
- [ ] A different member receives nothing.
- [ ] New unit tests pass and fail against the old behaviour.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run`
- [ ] `timeout 150 npx next build`
- [ ] Schema checks: not applicable (no schema change)

## Manual test steps

Two browsers: an owner and an invited member in the same workspace, `npm run dev` on port 3001.

1. As the owner, drop a comment pin and mention the member with the `@` picker. Confirm the chip shows the member's name.
2. As the member, confirm the bell shows an unread count and "<owner> mentioned you in a comment". Open it and confirm it lands on the thread.
3. Rename the member in their profile or settings, reload as the owner, and confirm the old comment shows the new name.
4. As the member, reply mentioning the owner. Confirm the owner gets a notification.
5. Switch the member's mention emails off, post another mention, and confirm there is no outbox row. Switch it back on, post again, and confirm one `email_outbox` row (and a delivered email if the email key is set).

## Follow-ups

- Mention chips in notes and docs may need the same lookup if reproduction shows it.
- Whether notification and email errors should surface somewhere better than `console.error` is a separate decision.
- Record the confirmed delivery cause in the progress tracker once known.
