import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorkspaceMembersData } from "@/lib/actions/members";
import { getNotificationPreferencesAction } from "@/lib/actions/notification-preferences";
import { requireViewerContext } from "@/lib/workspace";
import { canDeleteWorkspace, canManageWorkspace } from "@/lib/permissions";
import { accessLevelLabel } from "@/lib/emails/invitation";
import { SettingsNav, SettingsSection, type SettingsNavItem } from "@/components/settings/settings-shell";
import { WorkspaceGeneralSettings } from "@/components/settings/workspace-general-settings";
import { WorkspaceMembersManager } from "@/components/settings/workspace-members-manager";
import { NotificationPreferences } from "@/components/settings/notification-preferences";
import { WorkspaceDangerZone } from "@/components/settings/workspace-danger-zone";

// Members, invitations and the workspace name all change from other people's
// sessions, so this never caches.
export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireViewerContext();
  const [data, emailPreferences] = await Promise.all([getWorkspaceMembersData(), getNotificationPreferencesAction()]);
  if (!data) notFound();

  const canManage = canManageWorkspace(viewer.role);
  const canDelete = canDeleteWorkspace(viewer.role);
  const nav: SettingsNavItem[] = [
    { id: "general", label: "General", icon: "general" },
    { id: "members", label: "Members", icon: "members" },
    { id: "notifications", label: "Notifications", icon: "notifications" },
    ...(canDelete ? [{ id: "danger", label: "Danger zone", icon: "danger" as const, tone: "danger" as const }] : []),
  ];
  const monogram = (data.organizationName.trim()[0] ?? "W").toUpperCase();

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
        <header className="mb-6 sm:mb-10">
          <Link
            href={`/workspace/${slug}`}
            className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to canvas
          </Link>
          <div className="mt-5 flex items-center gap-4">
            <span
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted text-lg font-semibold text-foreground sm:h-14 sm:w-14 sm:text-xl"
            >
              {monogram}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {data.organizationName}
              </h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Workspace settings. You&apos;re{" "}
                <span className="font-medium text-foreground">
                  {viewer.role === "member" ? "a view-only member" : `the ${accessLevelLabel(viewer.role).toLowerCase()}`}
                </span>
                {viewer.role === "admin" ? " of this workspace." : "."}
              </p>
            </div>
          </div>
        </header>

        <div className="md:grid md:grid-cols-[190px_minmax(0,1fr)] md:gap-12">
          <SettingsNav items={nav} />

          <div className="mt-6 flex max-w-180 flex-col gap-10 md:mt-0">
            <SettingsSection id="general" title="General" description="How this workspace is named across Helm.">
              <WorkspaceGeneralSettings slug={slug} organizationName={data.organizationName} canManage={canManage} />
            </SettingsSection>

            <SettingsSection
              id="members"
              title="Members"
              description={
                canManage
                  ? "Invite people and manage who can see this workspace."
                  : "Everyone who can see this workspace."
              }
              aside={
                <span className="rounded-full border border-border px-2.5 py-0.5 text-[12px] tabular-nums text-muted-foreground">
                  {data.members.length} {data.members.length === 1 ? "person" : "people"}
                </span>
              }
            >
              <WorkspaceMembersManager
                slug={slug}
                initialMembers={data.members}
                initialInvitations={data.invitations}
                canManage={canManage}
                viewerUserId={viewer.userId}
              />
            </SettingsSection>

            <SettingsSection
              id="notifications"
              title="Notifications"
              description="Choose which notifications also arrive by email. This is personal to you."
            >
              <NotificationPreferences initialPreferences={emailPreferences} />
            </SettingsSection>

            {canDelete && (
              <SettingsSection
                id="danger"
                title="Danger zone"
                tone="danger"
                description="Permanent actions. Only the workspace owner sees this."
              >
                <WorkspaceDangerZone organizationName={data.organizationName} />
              </SettingsSection>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
