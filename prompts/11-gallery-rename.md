# One name: "Gallery" (retire "album" everywhere)

**Date:** 2026-10-10
**Branch:** `feature/gallery-rename` (stacked on `feature/gallery-viewer-actions`)
**Status:** approved (scope chosen by the user: "do everything", including the DB tables)

## Goal

The canvas widget is `gallery`; its page, code, tables and copy all said "album". One concept, one name. Done = no user-visible "album", the page lives at `/workspace/<slug>/gallery/<id>` (old `/albums/...` links redirect), the code and DB use gallery/galleries, and nothing saved is lost.

## What I read

- `AGENTS.md`, `CLAUDE.md`, progress tracker, `prompts/02`, `09`, `10`.
- Every file matching `album` (42 + migrations/snapshots): `lib/actions/albums.ts`, `lib/album-file.ts`, `lib/db.ts` (`albums`, `album_groups`, `album_images`, `album_id`, 5 indexes), `components/albums/*`, `components/canvas/gallery-widget.tsx`, `widget-node.tsx`, `widget-registry.ts`, `canvas-shell.tsx`, `workspace-dashboard.tsx`, `app/workspace/[slug]/page.tsx` + `albums/[albumId]/page.tsx`, `lib/query-keys.ts`, `lib/upload-client.ts`, `app/providers.tsx` (`CACHE_BUSTER`), tests, drizzle snapshot `0020`.
- `next.config.ts` (no redirects yet). `widgets.data` is `jsonb`; a gallery widget stores `{ albumId }`.

## Decisions and assumptions

- **Decision:** mechanical rename, in this order so plurals come out right: path moves first (`components/albums` -> `components/gallery`, `lib/actions/albums.ts` -> `lib/actions/galleries.ts`, `lib/album-file.ts` -> `lib/gallery-file.ts`, route `albums/[albumId]` -> `gallery/[galleryId]`, hooks `use-album-*` -> `use-gallery-*`, `album-grid/view` -> `gallery-grid/view`), then text: `albums`->`galleries`, `album`->`gallery`, with case variants, then fix "an gallery" -> "a gallery". Historical files (old prompts, old migrations, old snapshots, tracker history) are NOT edited.
- **Decision (DB):** one new migration `0021` does `ALTER TABLE ... RENAME` for the three tables, `RENAME COLUMN album_id -> gallery_id` on two, and renames the 5 indexes, 6 FK constraints and 3 pkeys so names match what drizzle would generate. Renames are metadata-only: no rows move, FKs/cascades keep working, lock is instant. It also rewrites `widgets.data` `albumId` -> `galleryId` for `type = 'gallery'` rows (jsonb, idempotent: only rows that still have `albumId`).
- **Decision (how the migration is produced):** `drizzle-kit generate` asks interactive "renamed or created?" questions that cannot be answered here, and a wrong answer generates DROP + CREATE (data loss). So the SQL is hand-written, the `0021` snapshot is the `0020` snapshot passed through the same rename with a new id, the journal entry is added, and then `drizzle-kit generate` is run to PROVE it: it must report no schema changes.
- **Decision:** the new route keeps working for old links via `redirects()` in `next.config.ts` (`/workspace/:slug/albums/:id` -> `/workspace/:slug/gallery/:id`, permanent).
- **Decision:** `CACHE_BUSTER` is bumped so browsers drop persisted `albumImages` / `albumPreview` entries instead of carrying dead keys in localStorage; the new keys are `galleryImages` / `galleryPreview`.
- **Rejected:** a tolerant reader for `albumId` in widget code (would keep the old name alive forever for a one-time data move the migration already does).
- **DEPLOY ORDER (needs the user):** there is one Neon database. The moment `0021` is applied, the currently deployed code (which queries `albums`) breaks until this branch is deployed, and the new code breaks until the migration is applied. So: **do not run `npm run db:migrate` against the shared DB until this is merged and its deploy is ready**; run it immediately before/with the deploy. Locally I verify the SQL by applying it inside a transaction that is rolled back.

## Files I expect to touch

Everything listed above, plus `next.config.ts`, `app/providers.tsx` (bust + comment), `AGENTS.md` (data model + product description say "albums"), `drizzle/migrations/0021_*.sql`, `meta/0021_snapshot.json`, `meta/_journal.json`, `.claude/context/progress-tracker.md`.

## Requirements

1. `grep -ri album` over `app components lib tests` returns nothing (migrations/snapshots excepted).
2. No user-visible "album" text; page title/placeholder/errors say gallery.
3. `/workspace/<slug>/gallery/<id>` renders the page; `/workspace/<slug>/albums/<id>` redirects to it.
4. Existing galleries, groups, images and canvas gallery widgets still show after the migration (rows renamed, `data.galleryId` populated).
5. `drizzle-kit generate` afterwards reports no changes.
6. All four checks pass; the rename SQL applies cleanly in a rolled-back transaction.

## Security / client data flow

No behaviour change: every action keeps its identity, `organizationId` scoping and role check (only identifiers renamed). Query keys change name only; they were already workspace-safe by unique id, and the persisted copies are dropped by the bumped buster.

## Manual test steps

1. (After the migration is applied to a DB you can afford to touch) open a canvas with an existing gallery widget: card shows count + thumbnails; click through to `/gallery/<id>`.
2. Open an old `/albums/<id>` URL: lands on `/gallery/<id>`.
3. Upload, move to a group, delete, download, lightbox: all as before.
4. Create a new gallery from a fresh widget: "Give the gallery a name." validation text.
