"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { and, eq, ilike, inArray, ne, notExists, or, sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/better-auth";
import { db } from "@/lib/db";
import { invitation, member, user } from "@/lib/auth-schema";
import { alias } from "drizzle-orm/pg-core";
import { requireViewerContext } from "@/lib/workspace";
import { canDeleteWorkspace, canManageWorkspace, mapAccessLevelToOrgRole, ACCESS_LEVELS } from "@/lib/permissions";
import { containsPattern } from "@/lib/utils";

export type MemberActionState = { error?: string };
export type InviteSuggestion = { email: string; name: string | null };

/** Below this a suggestion list is noise, and a one-character prefix search is
 *  closer to "list everyone" than to autocomplete. */
const MIN_SUGGESTION_QUERY_LENGTH = 2;
const SUGGESTION_LIMIT = 5;

/** `member` appears twice in the suggestion query — once to find people the
 *  viewer shares any workspace with, once to exclude those already in THIS one —
 *  so the second reference needs its own alias. */
const memberAlias = alias(member, "existing_member");

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  accessLevel: z.enum(ACCESS_LEVELS.map((l) => l.value) as [string, ...string[]]),
});

export async function inviteMemberAction(
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const viewer = await requireViewerContext();
  if (!canManageWorkspace(viewer.role)) {
    return { error: "Only workspace owners/admins can invite members." };
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    accessLevel: formData.get("accessLevel") ?? "view",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid invite." };
  }

  let role: ReturnType<typeof mapAccessLevelToOrgRole>;
  try {
    role = mapAccessLevelToOrgRole(parsed.data.accessLevel);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid access level." };
  }

  try {
    const reqHeaders = await headers();
    await auth.api.createInvitation({
      headers: reqHeaders,
      body: {
        email: parsed.data.email,
        role,
        organizationId: viewer.organizationId,
      },
    });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    throw err;
  }

  return {};
}

/** Everything the pinned canvas widget needs to render directly in the card
 *  — member list, invite form, rename, danger zone — no separate settings
 *  page/route. One call: getFullOrganization already joins org + members +
 *  invitations, so this replaces what used to be two separate API calls. */
export async function getWorkspaceMembersData() {
  const viewer = await requireViewerContext();
  const reqHeaders = await headers();
  const canManage = canManageWorkspace(viewer.role);

  const org = await auth.api.getFullOrganization({
    headers: reqHeaders,
    query: { organizationId: viewer.organizationId },
  });
  if (!org) {
    // requireViewerContext already guarantees session + active membership,
    // so this is unreachable in practice — narrows the type either way.
    throw new Error("Organization not found.");
  }

  return {
    organizationName: org.name,
    organizationSlug: org.slug,
    members: org.members,
    // Only managers can act on invites, so only they need to see them —
    // no reason to hand a plain member the list of pending invite emails.
    invitations: canManage ? org.invitations.filter((i) => i.status === "pending") : [],
    canManage,
    canDelete: canDeleteWorkspace(viewer.role),
    viewerUserId: viewer.userId,
  };
}

export async function listPendingInvitationsAction() {
  const viewer = await requireViewerContext();
  if (!canManageWorkspace(viewer.role)) {
    return { invitations: [] };
  }

  const reqHeaders = await headers();
  const invitations = await auth.api.listInvitations({
    headers: reqHeaders,
    query: { organizationId: viewer.organizationId },
  });

  return { invitations: invitations.filter((i) => i.status === "pending") };
}

const cancelInvitationSchema = z.object({
  invitationId: z.string().trim().min(1, "Invitation id is required."),
});

export async function cancelInvitationAction(
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const viewer = await requireViewerContext();
  if (!canManageWorkspace(viewer.role)) {
    return { error: "Only workspace owners/admins can cancel invitations." };
  }

  const parsed = cancelInvitationSchema.safeParse({ invitationId: formData.get("invitationId") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid invitation." };
  }

  try {
    const reqHeaders = await headers();
    await auth.api.cancelInvitation({
      headers: reqHeaders,
      body: { invitationId: parsed.data.invitationId },
    });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    throw err;
  }

  return {};
}

const removeSchema = z.object({
  memberIdOrEmail: z.string().trim().min(1, "Member id is required."),
});

export async function removeMemberAction(
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const viewer = await requireViewerContext();
  if (!canManageWorkspace(viewer.role)) {
    return { error: "Only workspace owners/admins can remove members." };
  }

  const parsed = removeSchema.safeParse({ memberIdOrEmail: formData.get("memberIdOrEmail") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid member." };
  }

  try {
    const reqHeaders = await headers();
    await auth.api.removeMember({
      headers: reqHeaders,
      body: {
        memberIdOrEmail: parsed.data.memberIdOrEmail,
        organizationId: viewer.organizationId,
      },
    });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    throw err;
  }

  return {};
}

const suggestSchema = z.object({ query: z.string().trim().max(120) });

/**
 * Email suggestions for the invite field.
 *
 * Scoped to people the viewer ALREADY shares a workspace with — deliberately
 * not a search over the whole `user` table. A global prefix search would let
 * any signed-in account enumerate every email address in the database one
 * keystroke at a time, which is a data leak dressed up as autocomplete. Anyone
 * outside that circle can still be invited by typing their address in full;
 * they just aren't suggested.
 *
 * Already-members and already-invited addresses are filtered out, since
 * inviting them again only produces an error.
 */
export async function suggestInviteEmailsAction(
  query: string,
): Promise<{ suggestions: InviteSuggestion[]; error?: string }> {
  const parsed = suggestSchema.safeParse({ query });
  if (!parsed.success) return { suggestions: [] };

  const viewer = await requireViewerContext();
  if (!canManageWorkspace(viewer.role)) return { suggestions: [] };

  const needle = parsed.data.query.trim();
  if (needle.length < MIN_SUGGESTION_QUERY_LENGTH) return { suggestions: [] };

  const pattern = containsPattern(needle);
  // Workspaces the viewer belongs to — the boundary of who may be suggested. A
  // correlated subquery rather than a separate round trip, so the whole thing
  // stays one statement.
  const viewerOrgs = db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, viewer.userId));

  const alreadyMember = db
    .select({ one: sql`1` })
    .from(memberAlias)
    .where(and(eq(memberAlias.organizationId, viewer.organizationId), eq(memberAlias.userId, user.id)));

  const alreadyInvited = db
    .select({ one: sql`1` })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, viewer.organizationId),
        eq(invitation.status, "pending"),
        sql`lower(${invitation.email}) = lower(${user.email})`,
      ),
    );

  // Matching, exclusion and the row cap all happen in SQL. Doing any of it in
  // JavaScript meant loading every user in every workspace the viewer belongs to
  // on each keystroke, which is fine for a handful of people and pointless work
  // for a real team.
  const rows = await db
    .selectDistinct({ email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        inArray(member.organizationId, viewerOrgs),
        ne(user.id, viewer.userId),
        or(ilike(user.email, pattern), ilike(user.name, pattern)),
        notExists(alreadyMember),
        notExists(alreadyInvited),
      ),
    )
    .limit(SUGGESTION_LIMIT);

  return { suggestions: rows };
}


export type MentionableMember = { id: string; name: string; image: string | null };

/** Who the `@` picker offers: members of the ACTIVE workspace only — id, name,
 *  avatar, never email. Any member can already see who else is in the
 *  workspace, so this exposes nothing new. The save path re-checks membership
 *  before notifying anyone, so this list is convenience, not the gate. */
export async function listMentionableMembersAction(): Promise<MentionableMember[]> {
  const viewer = await requireViewerContext();
  return db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, viewer.organizationId))
    .orderBy(user.name);
}
