# <Title of the change>

**Date:** YYYY-MM-DD
**Branch:** `<branch>`
**Status:** draft | approved | shipped

## Goal

What the user asked for, in one or two sentences, in their terms. Then what "done" means for them concretely.

## What I read

- `AGENTS.md`, `CLAUDE.md`, `.claude/context/progress-tracker.md`
- Files inspected, with what each one established:
  - `path/to/file.ts` — what it already does that this change has to fit into.

## Decisions and assumptions

- **Decision:** what, and why this over the alternative that was considered.
- **Assumption:** what I am taking to be true because the request did not say. Correct any of these and the plan changes.
- **Rejected:** approaches deliberately not taken, and the reason — so the next session does not retry them.

## Files I expect to touch

| File | Change |
| ---- | ------ |
| `path/to/file.ts` | new / edit — one line on what |

Include the migration file, the `.env.example` key, the query key, and the test file if the change needs them.

## Requirements

Numbered, testable statements. Each one should be something a reviewer can check is true or false by looking at the running app or the code.

1.
2.

## Data and schema

Tables and columns touched, the migration, and what happens to rows that already exist. Say "none" if none.

## Security

- Which entry point resolves identity, and how (`requireViewerContext` / `getRequestIdentity` / `verifyOAuthBearer`).
- How every query is scoped to `organizationId`.
- Which permission predicate gates each write.
- Any secret involved and why it cannot reach the browser.
- Rate limiting: which limiter, which identifier.

## Client data flow

- Query keys added or changed (workspace-scoped where required).
- Mutations, and every `invalidateQueries` key each one must fire.
- Anything persisted to localStorage, or deliberately excluded from persistence.

## Acceptance criteria

- [ ] Each requirement above, restated as something observable.

## Checks

- [ ] `rm -rf .next && npx tsc --noEmit`
- [ ] `npx eslint app components lib tests`
- [ ] `npx vitest run`
- [ ] `timeout 150 npx next build`
- [ ] `npx drizzle-kit generate` + `npm run db:migrate` (if the schema changed)

## Manual test steps

Exact steps, in order, that a person runs in `npm run dev` (port 3001) to see this working — including the workspace/role to be in and what to look for.

1.
2.

## Follow-ups

Anything deliberately left out of this change, and anything the user has to decide or deploy. Copy the ones that survive into `.claude/context/progress-tracker.md` when the work lands.
