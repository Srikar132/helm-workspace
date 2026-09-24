import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/better-auth";
import { requireViewerContext } from "@/lib/workspace";
import { getDocProject, getDocPages } from "@/lib/actions/docs";
import { DocsProjectView } from "@/components/docs/docs-project-view";

export const dynamic = "force-dynamic";

interface DocsProjectPageProps {
  params: Promise<{ slug: string; projectId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}

export default async function DocsProjectPage({ params, searchParams }: DocsProjectPageProps) {
  const { slug, projectId } = await params;
  const { page: pageParam } = await searchParams;
  const reqHeaders = await headers();

  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    redirect("/sign-in");
  }

  const organizations = await auth.api.listOrganizations({ headers: reqHeaders });
  const org = organizations.find((o) => o.slug === slug);
  if (!org) {
    redirect("/workspaces");
  }

  if (session.session.activeOrganizationId !== org.id) {
    await auth.api.setActiveOrganization({
      headers: reqHeaders,
      body: { organizationId: org.id },
    });
  }

  const viewer = await requireViewerContext();
  // getDocProject scopes by viewer.organizationId — a project id from
  // another workspace 404s here rather than leaking its existence.
  const project = await getDocProject(projectId);
  if (!project) {
    notFound();
  }

  const pages = await getDocPages(projectId);

  return (
    <DocsProjectView
      slug={slug}
      project={project}
      initialPages={pages}
      canWrite={viewer.role !== "member"}
      initialPageId={typeof pageParam === "string" ? pageParam : undefined}
    />
  );
}
