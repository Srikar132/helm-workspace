import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, organization } from "@/lib/db";
import { requireViewerContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// Notification emails link here ("Manage email notifications"). The switches
// live in the Notifications section of workspace settings now; this keeps
// every already-sent link working by forwarding to the viewer's own active
// workspace. requireViewerContext() sends signed-out visitors to sign-in.
export default async function NotificationSettingsRedirect() {
  const viewer = await requireViewerContext();
  const [org] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, viewer.organizationId))
    .limit(1);
  redirect(org ? `/workspace/${org.slug}/settings#notifications` : "/workspaces");
}
