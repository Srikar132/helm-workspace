import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/better-auth";
import { db, member as memberTable, organization, user } from "@/lib/db";
import type { OrgRole } from "@/lib/permissions";

export type ViewerContext = {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  role: OrgRole;
};

/** Session + active-organization + role for the current request. Redirects if either is missing. */
export async function requireViewerContext(): Promise<ViewerContext> {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session) {
    redirect("/sign-in");
  }

  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    redirect("/workspaces");
  }

  const member = await auth.api.getActiveMember({ headers: reqHeaders });
  if (!member) {
    redirect("/workspaces");
  }

  return {
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    organizationId,
    role: member.role as OrgRole,
  };
}

/** Where to land a signed-in user with no explicit destination: the workspace they
 *  last opened, or the workspaces list if they've since left it or never opened one. */
export async function getLandingPath(userId: string): Promise<string> {
  const [row] = await db
    .select({ slug: organization.slug })
    .from(user)
    .innerJoin(organization, eq(organization.id, user.lastActiveOrganizationId))
    .innerJoin(
      memberTable,
      and(eq(memberTable.organizationId, organization.id), eq(memberTable.userId, user.id)),
    )
    .where(eq(user.id, userId))
    .limit(1);

  return row ? `/workspace/${row.slug}` : "/workspaces";
}

export async function getLastActiveOrganizationId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.lastActiveOrganizationId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return row?.id ?? null;
}

export async function rememberLastWorkspace(userId: string, organizationId: string) {
  await db
    .update(user)
    .set({ lastActiveOrganizationId: organizationId })
    .where(and(eq(user.id, userId), sql`${user.lastActiveOrganizationId} is distinct from ${organizationId}`));
}

/** Role lookup for server-to-server callers (MCP/API-key auth) that have no browser session. */
export async function getMemberRole(
  userId: string,
  organizationId: string,
): Promise<OrgRole | undefined> {
  const [row] = await db
    .select({ role: memberTable.role })
    .from(memberTable)
    .where(and(eq(memberTable.userId, userId), eq(memberTable.organizationId, organizationId)))
    .limit(1);

  return row?.role as OrgRole | undefined;
}
