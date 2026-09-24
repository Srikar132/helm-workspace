/**
 * Query keys for anything scoped to a workspace.
 *
 * These exist because the workspace was missing from them. `["workspaceMembers"]`
 * and `["board", …]` are the same key in every workspace, so switching
 * workspaces by client-side navigation served the previous one's cached data —
 * the members list, the board, and the workspace NAME the delete dialog asks you
 * to retype. It asked for the old workspace's name and then rejected it, because
 * the server was checking the real one. Only a full reload cleared it, and the
 * cache is persisted to localStorage, so it outlived the tab too.
 *
 * Anything keyed by a globally unique id (an album, a doc project, an entry)
 * doesn't need this — the id already identifies the workspace implicitly. Nor
 * does anything per-user rather than per-workspace, like the Gmail queries.
 */

export function workspaceMembersKey(slug: string) {
  return ["workspaceMembers", slug] as const;
}

export function boardKey(slug: string, search: string, workType: string) {
  return ["board", slug, search, workType] as const;
}

/** Suggestions are filtered against the active workspace's existing members and
 *  pending invites, so the same typed text yields different results per
 *  workspace. */
export function inviteSuggestionsKey(slug: string, query: string) {
  return ["inviteSuggestions", slug, query] as const;
}

/** The `@` picker's member list for the active workspace. */
export function mentionableMembersKey(slug: string) {
  return ["mentionableMembers", slug] as const;
}

/** Per-USER, not per-workspace: the bell lists the viewer's notifications from
 *  every workspace they're in, so the workspace isn't part of the identity.
 *  That's also why these are excluded from localStorage persistence in
 *  app/providers.tsx — a static key would otherwise hydrate one account's
 *  notifications into the next account signed in on the same browser. One
 *  root so a single invalidate covers the count and the list. */
export const notificationKeys = {
  all: ["notifications"] as const,
  count: () => [...notificationKeys.all, "count"] as const,
  list: () => [...notificationKeys.all, "list"] as const,
};
