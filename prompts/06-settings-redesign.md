# Settings page redesign + notifications inside it

**Date:** 2026-09-24
**Branch:** `feature/email-notifications` (same branch as phase 3 — it replaces that phase's separate page)
**Status:** approved

## Goal

The user asked to (1) drop the separate `/settings/notifications` page and put the email-notification switches inside the workspace settings page, and (2) redesign that settings page, which today is one flat card: premium, meaningful, responsive and easy to understand.

"Done" = user menu → Workspace settings opens a sectioned page (General, Members, Notifications, Danger zone) with a section nav, that reads clearly on desktop and phone, in light and dark, and every existing action still works.

## What I read

- `app/workspace/[slug]/settings/page.tsx` — header + one card wrapping `WorkspaceMembersManager`.
- `components/settings/workspace-members-manager.tsx` — rename, invite (+ `InviteEmailField`, disabled access-level select, `CopyInviteLinkButton`), pending invites, member list, and `WorkspaceDangerZone`; one shared error banner; ALL-CAPS labels; hard-coded `white/[0.0x]` colours (break in light mode).
- `components/settings/workspace-danger-zone.tsx` — typed-name delete; reports errors via `onError`.
- `components/settings/notification-preferences.tsx`, `app/settings/notifications/page.tsx` (phase 3).
- `lib/email-unsubscribe.ts` — `notificationSettingsUrl()` is linked from every notification email.
- `components/canvas/canvas-chrome.tsx` — user menu (Workspace settings, Connections, Notifications, Sign out).
- `components/canvas/comments/comment-avatar.tsx` — avatar with `no-referrer`.

## Decisions and assumptions

- **Layout:** Linear/Vercel-style settings. Header: back link, workspace monogram, workspace name, "You're an owner/admin/view-only member" chip. Below: on ≥ `md` a sticky left section nav (General, Members, Notifications, Danger zone) with scroll-spy highlighting; on phones a sticky horizontally scrollable pill bar. Each section = a title + one-line description, then its card. Single column content, max ~720px.
- **Sections:**
  - **General** — workspace name (editable for owner/admin; read-only with a note otherwise).
  - **Members** — invite row (managers), pending invites with copy-link / cancel, member list with real avatars (no-referrer), name, email, role badge, "You" tag, remove. Count in the section title.
  - **Notifications** — the phase 3 email switches, labelled as personal ("applies to you in every workspace"), with a line that the bell always shows everything.
  - **Danger zone** — only for the owner; same typed-name flow, restyled.
- **Components split** so each section owns its state: `workspace-general-settings.tsx` (rename), `workspace-members-manager.tsx` (invite/pending/members only), `notification-preferences.tsx` (restyled), `workspace-danger-zone.tsx`. The shared error banner becomes toasts (errors belong to the action that raised them). Mutation logic, query keys and invalidations are unchanged.
- **Styling:** theme tokens only (`border-border`, `bg-card`, `bg-muted`, `text-muted-foreground`, `bg-input`…), sentence-case labels (no all-caps), `lucide-react` icons, shadcn `Button`. Motion only on user action (switch, hover).
- **Email links keep working:** `/settings/notifications` stays as a tiny server route that redirects to `/workspace/<active slug>/settings#notifications` (the user's active workspace), so links in already-sent emails don't 404. The standalone page UI is removed.
- **User menu:** the separate "Notifications" item is removed; "Workspace settings" is the way in.
- **Assumption:** the settings page stays per workspace (`/workspace/[slug]/settings`); notification prefs are per user and simply shown there.
- **Rejected:** a new global `/settings` hub (bigger change than asked); tabs that hide sections (a scrolling page with a nav is easier to scan and link to).

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `app/workspace/[slug]/settings/page.tsx` | new layout, loads email prefs too |
| `components/settings/settings-shell.tsx` | new — section nav (sticky/scroll-spy, mobile pills) + `SettingsSection` |
| `components/settings/workspace-general-settings.tsx` | new — rename |
| `components/settings/workspace-members-manager.tsx` | members only, restyled, avatars |
| `components/settings/workspace-danger-zone.tsx` | restyled, toast errors |
| `components/settings/notification-preferences.tsx` | restyled for the section |
| `app/settings/notifications/page.tsx` | becomes a redirect |
| `components/canvas/canvas-chrome.tsx` | drop the Notifications menu item |

## Requirements

1. User menu → Workspace settings shows General, Members, Notifications and (owner only) Danger zone, with a working section nav on desktop and a pill bar on phones.
2. Rename, invite, copy invite link, cancel invite, remove member and delete workspace behave exactly as before; failures show a toast.
3. View-only members see the name read-only, the member list without controls, and their own notification switches.
4. The two email switches work as in phase 3.
5. `/settings/notifications` (from emails) lands on the Notifications section of the active workspace's settings.
6. No hard-coded colours; readable in light and dark; no horizontal scroll at 360px.

## Security

Unchanged: every action keeps its own `requireViewerContext` + permission predicate; the redirect route resolves the viewer's own active workspace only.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run`
- [ ] `timeout 150 npx next build`

## Manual test steps

1. As owner: user menu → Workspace settings. Click each nav item → scrolls to it, item highlights while scrolling.
2. Rename the workspace → saved, switcher shows the new name.
3. Invite an email → appears in pending; copy link; cancel it.
4. Toggle Mentions email off/on → persists after reload.
5. Danger zone: typing the wrong name keeps Delete disabled.
6. Sign in as a view-only member → no rename/invite/remove/danger controls, switches present.
7. Narrow to 360px → pill nav, no sideways scroll; toggle light/dark.
8. Open `/settings/notifications` → lands on the Notifications section.
