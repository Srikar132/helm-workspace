export type OrgRole = "owner" | "admin" | "member";

/** Invite-time access level. Only "view" is wired up today — "edit"/"full" render
 *  disabled in the picker until per-role write permissions are built. */
export type AccessLevel = "view" | "edit" | "full";

export const ACCESS_LEVELS: { value: AccessLevel; label: string; enabled: boolean }[] = [
  { value: "view", label: "View only", enabled: true },
  { value: "edit", label: "Can edit", enabled: false },
  { value: "full", label: "Full access", enabled: false },
];

export function mapAccessLevelToOrgRole(level: string): OrgRole {
  if (level !== "view") {
    throw new Error(`Access level "${level}" isn't available yet — only "view" invites are supported.`);
  }
  return "member";
}

export function canManageWorkspace(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canWriteEntries(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Canvas widgets — layout and contents. Same owner/admin rule the board uses,
 *  kept as its own predicate so widget and entry permissions can diverge once
 *  real per-role write access lands (see ACCESS_LEVELS: only "view" invites
 *  exist today, so an invited member reads the workspace and writes nothing).
 *  Widget rows are scoped to the workspace, not to whoever created them, so
 *  this IS the write check — there is no userId filter behind it. */
export function canWriteWidgets(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** better-auth's org plugin only grants "organization:delete" to the owner
 *  role by default (admins can update, not delete) — this mirrors that. */
export function canDeleteWorkspace(role: OrgRole | null | undefined): boolean {
  return role === "owner";
}

/** Canvas comment threads — create, reply, resolve. The one write a view-only
 *  invitee gets: a mentioned teammate who couldn't answer would make mentions
 *  pointless. Commenting grants nothing else — entries and widgets still go
 *  through canWriteEntries / canWriteWidgets. */
export function canComment(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

/** Deleting or moving someone ELSE's comment or pin. Authors always manage
 *  their own; this is the moderation override, same people who manage the
 *  workspace. */
export function canModerateComments(role: OrgRole | null | undefined): boolean {
  return canManageWorkspace(role);
}
