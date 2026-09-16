import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/better-auth";
import { requireViewerContext } from "@/lib/workspace";
import { canWriteEntries } from "@/lib/permissions";
import { getFileFolders, getFileLibrary, getLibraryFiles } from "@/lib/actions/files";
import { LibraryView } from "@/components/files/library-view";

export const dynamic = "force-dynamic";

interface FilesPageProps {
  params: Promise<{ slug: string; libraryId: string }>;
}

export default async function FilesPage({ params }: FilesPageProps) {
  const { slug, libraryId } = await params;
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
  // getFileLibrary scopes by viewer.organizationId — a library id from another
  // workspace 404s here rather than leaking its existence.
  const library = await getFileLibrary(libraryId);
  if (!library) {
    notFound();
  }

  const [folders, firstPage] = await Promise.all([getFileFolders(libraryId), getLibraryFiles(libraryId)]);

  return (
    <LibraryView
      slug={slug}
      library={library}
      initialFolders={folders}
      initialFilesPage={firstPage}
      canWrite={canWriteEntries(viewer.role)}
    />
  );
}
