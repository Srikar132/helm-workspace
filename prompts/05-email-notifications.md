# Email notifications via Resend (issue #15, phase 3)

**Date:** 2026-09-24
**Branch:** `feature/email-notifications` (off `feature/canvas-comments`; stacked on PRs #26 → #27)
**Status:** approved

## Goal

Close out #15: *"Add an email notification pipeline with user preferences and unsubscribe controls."* Every mention and comment-reply notification that phases 1–2 create is also emailed to the recipient, from the newly bought `helmworkspace.me` domain through Resend (connected via the Vercel Resend integration). Users control which kinds they get by email, and every email carries a working unsubscribe.

"Done" = B is mentioned in a comment → within seconds B receives an email from `Helm <notifications@helmworkspace.me>` with who/where/snippet and an **Open** button that lands on the pin; B can turn mention or reply emails off at `/settings/notifications` or with one click from the email; nothing is ever sent twice.

## What I read

- `AGENTS.md`, `CLAUDE.md`, `.claude/context/progress-tracker.md`, `prompts/03-…`, `prompts/04-…`.
- `lib/email.ts` — `sendEmail({ to, subject, html, text })` over SMTP (nodemailer); log-only no-op when unconfigured. Its header comment already names this change: SMTP was chosen only because `*.vercel.app` can't be DNS-verified; "swapping in an API provider means reimplementing `deliver()` and nothing else".
- `lib/emails/invitation.ts` — `appOrigin()` (from `BETTER_AUTH_URL`), `escapeHtml`, inline-styled single-column HTML + plain-text pair. Template pattern to follow.
- `lib/better-auth.ts` — the invitation hook is the only current `sendEmail` caller (`.catch` logged).
- `lib/notifications.ts` — `notify()` inserts with `ON CONFLICT DO NOTHING` on `dedupe_key`; kinds `mention` | `comment_reply`; runs inside `after()`.
- `app/api/cron/cloudinary-cleanup/route.ts` + `vercel.json` — the durable-job precedent: job row written in the request, `after()` attempts it, a daily cron guarantees it; `CRON_SECRET` bearer check.
- `app/settings/connections/page.tsx` — settings page layout; user menu entry lives in `components/canvas/canvas-chrome.tsx`.
- `.env.example` — no SMTP keys documented today (drift); `package.json` — `nodemailer` + `@types/nodemailer`.
- `resend@6.28.1` package types — `emails.send(payload, { idempotencyKey })`, `headers` for custom headers.
- Resend DNS (DKIM TXT `resend._domainkey`, SPF CNAMEs `send`/`rsend`, DMARC) — being added at Namecheap by the user.

## Decisions and assumptions

User decisions (2026-09-24):
- **Immediate** emails — one per notification, sent right after it's created.
- **On by default** for mentions and replies.
- **From** `Helm <notifications@helmworkspace.me>`.
- **Resend only** — SMTP/nodemailer removed.

Design:
- **Decision: `lib/email.ts` keeps its contract** (`sendEmail` + no-op when unconfigured) and swaps SMTP for the Resend SDK. It gains optional `headers` and `idempotencyKey`. Invitations move to Resend with no change at their call site. `nodemailer`, `@types/nodemailer` and the `SMTP_*` keys are removed; `RESEND_API_KEY` + `EMAIL_FROM` documented in `.env.example`.
- **Decision: durable outbox** — `email_outbox` row per emailed notification, written by `notify()` right after the notification insert (only for rows actually inserted, so dedupe carries over). `after()` delivers immediately; a new daily cron `/api/cron/email-outbox` retries `pending`/`failed` rows (max 5 attempts). Resend `idempotencyKey` = outbox id, so a retry after an unknown outcome can't double-send.
- **Decision: preferences** — `notification_preferences(user_id, kind, email_enabled)`; a missing row means the default (**on**). In-app notifications are always on (the bell is the product; only email is noisy). Checked twice: when queueing and again at send time (a user who turns email off between queue and send gets nothing).
- **Decision: skip rules at send time** — skip (status `skipped`, with reason) if: the notification was already read in the bell; the recipient disabled that kind; the recipient is no longer a member of that workspace; or they've received ≥ 20 notification emails in the past hour (cap). Skips are not retried.
- **Decision: templates** — `lib/emails/notification.ts`: subject `Asha mentioned you in a comment` / `Asha replied to a comment`, body with workspace name, the plain-text snippet (escaped), an **Open in Helm** button (absolute URL = `appOrigin()` + the notification's server-built `payload.href`), and a footer with "Manage email notifications" + "Unsubscribe from these emails". `escapeHtml` moves to `lib/emails/html.ts`, shared with the invitation template. Inline styles, text + HTML, same visual language as the invitation email.
- **Decision: unsubscribe** — token = `base64url(userId.kind).HMAC-SHA256` keyed by a key derived from `BETTER_AUTH_SECRET` with the label `email-unsubscribe` (no new secret to manage); constant-time compare; no expiry (unsubscribe links must keep working). It can only ever set `email_enabled = false` for that user + kind.
  - Body link → `/unsubscribe/[token]`: a public page (no session, like `/share/docs`) that shows what will be turned off and a **Turn off** button (a server action verifying the token). A button, not an automatic GET, because mail scanners prefetch links.
  - Header `List-Unsubscribe: <https://helmworkspace.me/api/unsubscribe?token=…>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) → `POST /api/unsubscribe` turns it off immediately. This is what gives Gmail's native Unsubscribe button and is required by Gmail/Yahoo bulk-sender rules.
- **Decision: settings page** `/settings/notifications` — two toggles (Mentions, Replies to your threads) for email, a line explaining the bell always shows everything; linked from the user menu under Connections. Server actions `getNotificationPreferencesAction` / `setEmailPreferenceAction`.
- **Decision: cron auth** — the new route requires `CRON_SECRET` in production (returns 503 if unset there), unlike the cleanup route which runs open when unset. Local dev without the secret still works.
- **Decision:** new tables use `timestamptz`.
- **Assumption:** `RESEND_API_KEY` is already in the Vercel project env via the integration; locally the user copies it into `.env.local`. Without it, sends log and the outbox rows stay `pending` (the cron delivers once configured) — same degrade-don't-fail rule as today.
- **Assumption:** the Resend domain is verified before production emails go out; until then Resend rejects sends and rows land in `failed` for the cron to retry.
- **Assumption:** emails are English, plain, no images/tracking pixels.
- **Rejected:** a digest (user chose immediate); a provider abstraction keeping SMTP (AGENTS: no abstraction with one provider); sending from inside `notify()`'s DB write synchronously (must never slow or fail the save); GET-based one-click unsubscribe in the body (link scanners would unsubscribe people).

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `package.json` / lockfile | + `resend`; − `nodemailer`, `@types/nodemailer` |
| `.env.example` | `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` documented |
| `lib/email.ts` | Resend instead of SMTP; `headers`, `idempotencyKey` |
| `lib/emails/html.ts` | new — `escapeHtml` (moved) |
| `lib/emails/invitation.ts` | import `escapeHtml` from `html.ts` |
| `lib/emails/notification.ts` | new — mention / reply templates |
| `lib/email-unsubscribe.ts` | new — sign / verify tokens, URLs |
| `lib/db.ts` + `drizzle/migrations/0020_*.sql` | `notification_preferences`, `email_outbox` |
| `lib/notification-email.ts` | new — `queueNotificationEmails`, `deliverOutbox(ids?)`, pure `emailSkipReason` |
| `lib/notifications.ts` | after insert: `returning` ids → queue + `after`-deliver |
| `lib/actions/notification-preferences.ts` | new — get / set (session), `unsubscribeWithTokenAction` (token) |
| `app/settings/notifications/page.tsx` + `components/settings/notification-preferences.tsx` | new |
| `app/unsubscribe/[token]/page.tsx` | new — public confirm page |
| `app/api/unsubscribe/route.ts` | new — RFC 8058 one-click POST |
| `app/api/cron/email-outbox/route.ts` + `vercel.json` | new daily cron |
| `components/canvas/canvas-chrome.tsx` | "Notifications" item in the user menu |
| `tests/email-notifications.test.ts` | new — tokens, skip rules, templates (escaping, links), default prefs |

## Requirements

1. With `RESEND_API_KEY` set, a new mention or reply notification produces exactly one email to the recipient from `Helm <notifications@helmworkspace.me>`.
2. The email names the actor and place, shows the snippet (HTML-escaped), and its **Open in Helm** button goes to the same place the bell would (absolute `https://helmworkspace.me/...`).
3. Invitations are sent through Resend and look unchanged.
4. Autosave bursts, retries and the cron never send the same notification twice.
5. A notification already read in the bell before sending, a disabled kind, a recipient who left the workspace, or a recipient over 20 emails/hour → no email (row `skipped` with a reason).
6. A failed send (Resend down, domain unverified) is retried by the daily cron up to 5 attempts; never blocks or fails the originating save.
7. `/settings/notifications` shows Mentions and Replies email toggles, defaulting on; changes persist and take effect for the next notification.
8. Every notification email has a footer unsubscribe link → public page → **Turn off** disables that kind for that user without signing in; a tampered or foreign token does nothing and says the link is invalid.
9. Gmail shows its native Unsubscribe (List-Unsubscribe + one-click POST), which disables that kind immediately.
10. Without `RESEND_API_KEY`: no crash anywhere; sends are logged; outbox rows stay pending.
11. The email cron route rejects callers without the `CRON_SECRET` bearer in production.

## Data and schema

`notification_preferences`: `user_id` text → user (cascade), `kind` text, `email_enabled` boolean not null, `updated_at` timestamptz; unique `(user_id, kind)`. Missing row = enabled.

`email_outbox`: `id` uuid pk, `notification_id` uuid → notifications (cascade) **unique**, `recipient_id` text → user (cascade), `status` text (`pending` | `sent` | `skipped` | `failed`), `attempts` int default 0, `last_error` text, `skip_reason` text, `created_at` / `updated_at` / `sent_at` timestamptz. Index `(status, created_at)` for the cron.

Additive. `npx drizzle-kit generate` → `npm run db:migrate`.

## Security

- **Identity:** preference actions use `requireViewerContext()` and only touch `user_id = viewer.userId`. The unsubscribe page, action and POST route authenticate nobody by design; the HMAC token is the whole authorization and can only turn OFF one kind for one user.
- **Token:** HMAC-SHA256 with a key derived from `BETTER_AUTH_SECRET` (server-only), `timingSafeEqual`, strict base64url parsing; the page never reveals whose token it is beyond the kind.
- **Secrets:** `RESEND_API_KEY`, `BETTER_AUTH_SECRET`, `CRON_SECRET` read only in server files.
- **Content:** snippet and names escaped in HTML; links are built from `appOrigin()` + server-built hrefs only.
- **Cron:** bearer `CRON_SECRET`, required in production.
- **Rate:** the 20/hour per-recipient cap bounds email volume; `setEmailPreferenceAction` uses `checkRateLimit`.
- **Membership:** re-checked at send time so someone removed from a workspace stops getting its mail.

## Client data flow

- `notificationPreferencesKey()` = `["notificationPreferences"]` — per-user, **excluded from persistence** (same reason as the bell).
- `useMutation` for a toggle, optimistic with rollback, `invalidateQueries` on settle; `unwrapAction()`; `mutate` destructured.
- Unsubscribe page: server component + a form posting to the server action (no client query).

## Acceptance criteria

- [ ] R1–R3: mention/reply email arrives from the new sender with correct content and link; invitations still arrive.
- [ ] R4: one email per notification under autosave bursts, retries and cron.
- [ ] R5: each skip rule produces no email and a `skipped` row with the reason.
- [ ] R6/R10: failures retry via cron; no key → no crash, rows pending.
- [ ] R7: settings toggles persist and are honoured.
- [ ] R8/R9: footer link and Gmail one-click both turn the kind off; tampered token rejected.
- [ ] R11: cron rejects unauthenticated calls in production.
- [ ] Unit tests for tokens, skip rules, templates, default preferences.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run`
- [ ] `timeout 150 npx next build`
- [ ] `npx drizzle-kit generate` + `npm run db:migrate`

## Manual test steps

Prereqs: Resend shows `helmworkspace.me` **Verified**; `RESEND_API_KEY` and `EMAIL_FROM="Helm <notifications@helmworkspace.me>"` in `.env.local`; two accounts A (owner) and B (member) with real inboxes.

1. A invites a third address → the invitation email arrives from `notifications@helmworkspace.me`.
2. A mentions B in a canvas comment → B gets "A mentioned you in a comment" within seconds; **Open in Helm** lands on the pin.
3. A types more (autosaves) → still one email.
4. B replies; A gets "B replied to a comment".
5. B opens `/settings/notifications` (user menu → Notifications), turns Mentions off → A mentions B again → bell shows it, no email.
6. In A's reply email, click "Unsubscribe from these emails" → page shows "reply emails" → **Turn off** → next reply sends no email; the settings page shows Replies off.
7. Edit the token in the URL → "This unsubscribe link isn't valid."
8. In Gmail, the header Unsubscribe button works for a mention email.
9. Mark a notification read in the bell before the cron retries a failed row → the row ends `skipped` (simulate by unsetting `RESEND_API_KEY`, triggering, reading, restoring, calling the cron locally).
10. Unset `RESEND_API_KEY` → mentions still work in-app; console shows "would have sent".

## Follow-ups

- Digest mode (user chose immediate for now).
- Per-workspace email preferences.
- Resend webhooks (bounces/complaints) to auto-disable dead addresses.
- AI alerts: a new kind + preference row, nothing else.
