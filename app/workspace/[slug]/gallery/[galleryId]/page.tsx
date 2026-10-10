import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/better-auth";
import { requireViewerContext } from "@/lib/workspace";
import { getGallery, getGalleryGroups, getGalleryImages } from "@/lib/actions/galleries";
import { GalleryView } from "@/components/gallery/gallery-view";

export const dynamic = "force-dynamic";

interface GalleryPageProps {
  params: Promise<{ slug: string; galleryId: string }>;
}

export default async function GalleryPage({ params }: GalleryPageProps) {
  const { slug, galleryId } = await params;
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
  // getGallery scopes by viewer.organizationId — a gallery id from another
  // workspace 404s here rather than leaking its existence.
  const gallery = await getGallery(galleryId);
  if (!gallery) {
    notFound();
  }

  const [groups, firstPage] = await Promise.all([getGalleryGroups(galleryId), getGalleryImages(galleryId)]);

  return (
    <GalleryView
      slug={slug}
      gallery={gallery}
      initialGroups={groups}
      initialImagesPage={firstPage}
      canWrite={viewer.role !== "member"}
    />
  );
}
