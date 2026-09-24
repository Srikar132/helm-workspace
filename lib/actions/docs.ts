"use server";

import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, docProjects, docPages, type DocLink } from "@/lib/db";
import { requireViewerContext } from "@/lib/workspace";
import { canWriteEntries } from "@/lib/permissions";
import { extractMentionIds, redactMentions } from "@/lib/mentions";
import { docPageHref, notifyNewMentions } from "@/lib/notifications";

export type DocActionState = { error?: string };
export type CreateDocProjectResult = { error?: string; id?: string };

export type DocProjectSummary = {
  id: string;
  title: string;
  description: string | null;
  githubLinks: DocLink[];
  resourceLinks: DocLink[];
  liveLink: string | null;
  isPublic: boolean;
  shareToken: string;
};

export type DocPageRow = typeof docPages.$inferSelect;

function parseLinks(raw: FormDataEntryValue | null): DocLink[] {
  return String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}

const createProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120, "Keep it under 120 characters."),
  description: z.string().trim().max(2000).optional(),
  liveLink: z.string().trim().max(500).optional(),
});

export async function createDocProjectAction(
  _prevState: CreateDocProjectResult,
  formData: FormData,
): Promise<CreateDocProjectResult> {
  const parsed = createProjectSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    liveLink: formData.get("liveLink") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid project." };
  }

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) {
    return { error: "View-only access." };
  }

  const [project] = await db
    .insert(docProjects)
    .values({
      organizationId: viewer.organizationId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      liveLink: parsed.data.liveLink ?? null,
      githubLinks: parseLinks(formData.get("githubLinks")),
      resourceLinks: parseLinks(formData.get("resourceLinks")),
      shareToken: crypto.randomUUID(),
      createdBy: viewer.userId,
    })
    .returning({ id: docProjects.id });

  if (!project) {
    return { error: "Could not create the project. Please try again." };
  }

  // Sequential, not a transaction — the neon-http driver doesn't support
  // multi-statement transactions. Worst case of a rare failure here is a
  // project with zero pages; "+ Add page" in the docs route still works.
  await db.insert(docPages).values({ docProjectId: project.id, title: "Overview" });

  return { id: project.id };
}

const updateProjectSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required.").max(120),
  description: z.string().trim().max(2000).optional(),
  liveLink: z.string().trim().max(500).optional(),
});

export async function updateDocProjectAction(
  _prevState: DocActionState,
  formData: FormData,
): Promise<DocActionState> {
  const parsed = updateProjectSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    liveLink: formData.get("liveLink") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid project." };
  }

  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) {
    return { error: "View-only access." };
  }

  await db
    .update(docProjects)
    .set({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      liveLink: parsed.data.liveLink ?? null,
      githubLinks: parseLinks(formData.get("githubLinks")),
      resourceLinks: parseLinks(formData.get("resourceLinks")),
      updatedAt: new Date(),
    })
    .where(and(eq(docProjects.id, parsed.data.id), eq(docProjects.organizationId, viewer.organizationId)));

  revalidateTag(`doc-project:${parsed.data.id}`, { expire: 0 });
  return {};
}

export async function setDocProjectPublic(
  id: string,
  isPublic: boolean,
): Promise<{ error?: string; shareToken?: string }> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) {
    return { error: "View-only access." };
  }

  const [project] = await db
    .update(docProjects)
    .set({ isPublic, updatedAt: new Date() })
    .where(and(eq(docProjects.id, id), eq(docProjects.organizationId, viewer.organizationId)))
    .returning({ shareToken: docProjects.shareToken });

  if (!project) return { error: "Project not found." };
  revalidateTag(`doc-project:${id}`, { expire: 0 });
  return { shareToken: project.shareToken };
}

export async function deleteDocProjectAction(id: string): Promise<DocActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) {
    return { error: "View-only access." };
  }

  await db
    .delete(docProjects)
    .where(and(eq(docProjects.id, id), eq(docProjects.organizationId, viewer.organizationId)));

  revalidateTag(`doc-project:${id}`, { expire: 0 });
  revalidateTag(`doc-pages:${id}`, { expire: 0 });
  return {};
}

export async function createDocPage(docProjectId: string, title = "Untitled"): Promise<{ id?: string; error?: string }> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) {
    return { error: "View-only access." };
  }

  const owned = await getDocProject(docProjectId);
  if (!owned) return { error: "Project not found." };

  const existing = await db
    .select({ position: docPages.position })
    .from(docPages)
    .where(eq(docPages.docProjectId, docProjectId))
    .orderBy(asc(docPages.position));

  const nextPosition = existing.length ? Math.max(...existing.map((p) => p.position)) + 1 : 0;

  const [page] = await db
    .insert(docPages)
    .values({ docProjectId, title, position: nextPosition })
    .returning({ id: docPages.id });

  revalidateTag(`doc-pages:${docProjectId}`, { expire: 0 });
  return { id: page?.id };
}

export async function updateDocPage(
  id: string,
  patch: { title?: string; content?: Record<string, unknown> },
): Promise<DocActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) {
    return { error: "View-only access." };
  }

  const [page] = await db
    .select({ docProjectId: docPages.docProjectId, title: docPages.title, content: docPages.content })
    .from(docPages)
    .where(eq(docPages.id, id))
    .limit(1);
  if (!page) return { error: "Page not found." };

  // getDocProject scopes by viewer.organizationId — this is what actually
  // stops one workspace from editing another's page by guessing a page id.
  const owned = await getDocProject(page.docProjectId);
  if (!owned) return { error: "Page not found." };

  await db
    .update(docPages)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(docPages.id, id));

  if (patch.content && extractMentionIds(patch.content).length > 0) {
    const docProjectId = page.docProjectId;
    const title = `${patch.title ?? page.title} · ${owned.title}`;
    after(() =>
      notifyNewMentions({
        organizationId: viewer.organizationId,
        actorId: viewer.userId,
        sourceType: "doc_page",
        sourceId: id,
        prev: page.content,
        next: patch.content,
        title,
        href: (slug) => docPageHref(slug, docProjectId, id),
      }),
    );
  }

  revalidateTag(`doc-pages:${page.docProjectId}`, { expire: 0 });
  return {};
}

export async function deleteDocPage(id: string, docProjectId: string): Promise<DocActionState> {
  const viewer = await requireViewerContext();
  if (!canWriteEntries(viewer.role)) {
    return { error: "View-only access." };
  }

  const owned = await getDocProject(docProjectId);
  if (!owned) return { error: "Project not found." };

  const remaining = await db
    .select({ id: docPages.id })
    .from(docPages)
    .where(eq(docPages.docProjectId, docProjectId));

  if (remaining.length <= 1) {
    return { error: "A project needs at least one page." };
  }
  if (!remaining.some((p) => p.id === id)) {
    return { error: "Page not found." };
  }

  await db.delete(docPages).where(eq(docPages.id, id));
  revalidateTag(`doc-pages:${docProjectId}`, { expire: 0 });
  return {};
}

export async function getDocProjectsForWorkspace(): Promise<DocProjectSummary[]> {
  const viewer = await requireViewerContext();
  const rows = await db
    .select()
    .from(docProjects)
    .where(eq(docProjects.organizationId, viewer.organizationId));
  return rows;
}

export async function getDocProject(id: string): Promise<DocProjectSummary | null> {
  const viewer = await requireViewerContext();
  const organizationId = viewer.organizationId;
  return unstable_cache(
    async () => {
      const [row] = await db
        .select()
        .from(docProjects)
        .where(and(eq(docProjects.id, id), eq(docProjects.organizationId, organizationId)))
        .limit(1);
      return row ?? null;
    },
    ["doc-project", id, organizationId],
    { tags: [`doc-project:${id}`], revalidate: 300 },
  )();
}

/** Batched lookup for the canvas — avoids one client round-trip per
 *  project-doc widget on the canvas (still one round trip: the ids resolve
 *  in parallel, each through getDocProject's own per-project cache, rather
 *  than one shared uncached query). Called server-side (page.tsx) so it
 *  runs in parallel with the other canvas prefetches, and again client-side
 *  via useQuery for anything created after that initial render. */
export async function getDocProjectsByIds(ids: string[]): Promise<Record<string, DocProjectSummary>> {
  if (ids.length === 0) return {};
  const rows = await Promise.all(ids.map((id) => getDocProject(id)));
  return Object.fromEntries(rows.filter((row): row is DocProjectSummary => row !== null).map((row) => [row.id, row]));
}

export async function getDocPages(docProjectId: string): Promise<DocPageRow[]> {
  await requireViewerContext();
  return unstable_cache(
    async () =>
      db.select().from(docPages).where(eq(docPages.docProjectId, docProjectId)).orderBy(asc(docPages.position)),
    ["doc-pages", docProjectId],
    { tags: [`doc-pages:${docProjectId}`], revalidate: 300 },
  )();
}

/** Deliberately the one query in this app allowed to run with no session —
 *  backs the public /share/docs/[token] route. Callers must still check
 *  `isPublic` themselves before rendering anything. Time-based only (no
 *  revalidateTag wiring from the private mutations above, which only know
 *  the project id, not its share token) — a public reader can see up to 5
 *  minutes of staleness, which is an acceptable tradeoff for a read-only
 *  external page. */
export async function getDocProjectByShareToken(token: string) {
  return unstable_cache(
    async () => {
      const [project] = await db.select().from(docProjects).where(eq(docProjects.shareToken, token)).limit(1);
      if (!project) return null;
      const pages = await db
        .select()
        .from(docPages)
        .where(eq(docPages.docProjectId, project.id))
        .orderBy(asc(docPages.position));
      // Public, unauthenticated page: who was mentioned is workspace-private.
      return { project, pages: pages.map((page) => ({ ...page, content: redactMentions(page.content) })) };
    },
    ["doc-share", token],
    { tags: [`doc-share:${token}`], revalidate: 300 },
  )();
}
