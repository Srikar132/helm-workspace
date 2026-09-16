"use server";

import { and, asc, count, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { db, landmarks } from "@/lib/db";
import { requireViewerContext } from "@/lib/workspace";
import { canWriteWidgets } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { LANDMARK_COLORS } from "@/lib/constants";

export type Landmark = {
  id: string;
  name: string;
  slug: string;
  default: boolean;
  color: string;
  createdAt: Date;
};

const READ_ONLY_ERROR = "You have view-only access to this workspace.";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** First free `<slug>`, `<slug>-2`, `<slug>-3`… within THIS workspace. The
 *  prefix filter runs in Postgres (indexed range scan on (organization_id,
 *  slug)), and only exact-or-`-<n>` suffixed matches count — `home` must not
 *  collide with an unrelated `homework`. The (organization_id, slug) unique
 *  index is the backstop if two members race the same name. */
async function uniqueSlug(organizationId: string, name: string): Promise<string> {
  const base = slugify(name) || "landmark";
  // slugify output is [a-z0-9-] only, so base needs no LIKE escaping.
  const rows = await db
    .select({ slug: landmarks.slug })
    .from(landmarks)
    .where(and(eq(landmarks.organizationId, organizationId), like(landmarks.slug, `${base}%`)));
  const taken = new Set(
    rows.map((row) => row.slug).filter((slug) => slug === base || slug.startsWith(`${base}-`)),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function isValidLandmarkColor(color: string): boolean {
  return LANDMARK_COLORS.some((c) => c.value === color);
}

function landmarkColumns() {
  return {
    id: landmarks.id,
    name: landmarks.name,
    slug: landmarks.slug,
    default: landmarks.default,
    color: landmarks.color,
    createdAt: landmarks.createdAt,
  };
}

/** One landmark by id, scoped to the viewer's workspace. Feeds each landmark
 *  pin on the canvas; unknown ids come back null rather than throwing. */
export async function getLandmark(id: string): Promise<Landmark | null> {
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return null;
  const viewer = await requireViewerContext();
  const [row] = await db
    .select(landmarkColumns())
    .from(landmarks)
    .where(and(eq(landmarks.id, parsedId.data), eq(landmarks.organizationId, viewer.organizationId)))
    .limit(1);
  return row ?? null;
}

/** Every landmark in the active workspace — feeds the toolbar's search list.
 *  Single indexed query, oldest first so list order matches creation order. */
export async function listLandmarks(): Promise<Landmark[]> {
  const viewer = await requireViewerContext();
  return db
    .select(landmarkColumns())
    .from(landmarks)
    .where(eq(landmarks.organizationId, viewer.organizationId))
    .orderBy(asc(landmarks.createdAt));
}

/** THE landmark to open the canvas at — exactly one per workspace by
 *  construction (see setDefaultLandmarkAction / createLandmarkAction). One
 *  indexed query; null while the workspace has no landmarks yet, and the
 *  canvas just fits its widgets instead. */
export async function getDefaultLandmark(): Promise<Landmark | null> {
  const viewer = await requireViewerContext();
  const [row] = await db
    .select(landmarkColumns())
    .from(landmarks)
    .where(and(eq(landmarks.organizationId, viewer.organizationId), eq(landmarks.default, true)))
    .limit(1);
  return row ?? null;
}

/** Batched server-prefetch for landmark widgets on the canvas — one query for
 *  all of them instead of N round-trips on mount. */
export async function getLandmarksByIds(ids: string[]): Promise<Record<string, Landmark>> {
  if (ids.length === 0) return {};
  const viewer = await requireViewerContext();
  const rows = await db
    .select(landmarkColumns())
    .from(landmarks)
    .where(and(inArray(landmarks.id, ids), eq(landmarks.organizationId, viewer.organizationId)));
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

const nameColorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string(),
});

export async function createLandmarkAction(
  input: { name: string; color: string },
): Promise<Landmark & { error?: string }> {
  const parsed = nameColorSchema.safeParse(input);
  if (!parsed.success) return { ...EMPTY_LANDMARK, error: "Give the landmark a name (1–80 characters)." };
  if (!isValidLandmarkColor(parsed.data.color)) return { ...EMPTY_LANDMARK, error: "Unknown landmark colour." };

  const viewer = await requireViewerContext();
  if (!canWriteWidgets(viewer.role)) return { ...EMPTY_LANDMARK, error: READ_ONLY_ERROR };
  const rateLimit = await checkRateLimit(`create-landmark:${viewer.userId}`);
  if (!rateLimit.success) return { ...EMPTY_LANDMARK, error: rateLimit.error };

  // The very first landmark in a workspace becomes its HOME — the canvas
  // opens there from then on.
  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(landmarks)
    .where(eq(landmarks.organizationId, viewer.organizationId));

  try {
    const [row] = await db
      .insert(landmarks)
      .values({
        organizationId: viewer.organizationId,
        userId: viewer.userId,
        name: parsed.data.name,
        slug: await uniqueSlug(viewer.organizationId, parsed.data.name),
        default: existing === 0,
        color: parsed.data.color,
      })
      .returning();
    return row;
  } catch {
    // Unique-violation fallback: someone created the same name first.
    return { ...EMPTY_LANDMARK, error: "A landmark with that name already exists." };
  }
}

const updateNameSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80) });

/** Rename recomputes the slug — slug is derived identity, never hand-edited.
 *  The old slug dies with the old name; nothing else holds a reference to it. */
export async function renameLandmarkAction(input: {
  id: string;
  name: string;
}): Promise<Landmark & { error?: string }> {
  const parsed = updateNameSchema.safeParse(input);
  if (!parsed.success) return { ...EMPTY_LANDMARK, error: "Give the landmark a name (1–80 characters)." };

  const viewer = await requireViewerContext();
  if (!canWriteWidgets(viewer.role)) return { ...EMPTY_LANDMARK, error: READ_ONLY_ERROR };

  const [current] = await db
    .select()
    .from(landmarks)
    .where(and(eq(landmarks.id, parsed.data.id), eq(landmarks.organizationId, viewer.organizationId)))
    .limit(1);
  if (!current) return { ...EMPTY_LANDMARK, error: "That landmark no longer exists." };
  if (parsed.data.name === current.name) return current;

  try {
    const [updated] = await db
      .update(landmarks)
      .set({
        name: parsed.data.name,
        slug: await uniqueSlug(viewer.organizationId, parsed.data.name),
        updatedAt: new Date(),
      })
      .where(eq(landmarks.id, current.id))
      .returning();
    return updated;
  } catch {
    return { ...EMPTY_LANDMARK, error: "A landmark with that name already exists." };
  }
}

const colorSchema = z.object({ id: z.string().uuid(), color: z.string() });

export async function setLandmarkColorAction(input: {
  id: string;
  color: string;
}): Promise<Landmark & { error?: string }> {
  const parsed = colorSchema.safeParse(input);
  if (!parsed.success || !isValidLandmarkColor(parsed.data.color)) {
    return { ...EMPTY_LANDMARK, error: "Unknown landmark colour." };
  }

  const viewer = await requireViewerContext();
  if (!canWriteWidgets(viewer.role)) return { ...EMPTY_LANDMARK, error: READ_ONLY_ERROR };

  const updated = await db
    .update(landmarks)
    .set({ color: parsed.data.color, updatedAt: new Date() })
    .where(and(eq(landmarks.id, parsed.data.id), eq(landmarks.organizationId, viewer.organizationId)))
    .returning();
  if (updated.length === 0) return { ...EMPTY_LANDMARK, error: "That landmark no longer exists." };

  return updated[0];
}

/** Exactly-one-default invariant lives here: both writes happen inside one
 *  transaction, so there is never a moment with zero or two defaults. The
 *  no-op path (already the default) skips the writes entirely. */
export async function setDefaultLandmarkAction(input: { id: string }): Promise<Landmark & { error?: string }> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ...EMPTY_LANDMARK, error: "Invalid landmark." };

  const viewer = await requireViewerContext();
  if (!canWriteWidgets(viewer.role)) return { ...EMPTY_LANDMARK, error: READ_ONLY_ERROR };

  const [current] = await db
    .select()
    .from(landmarks)
    .where(and(eq(landmarks.id, parsed.data.id), eq(landmarks.organizationId, viewer.organizationId)))
    .limit(1);
  if (!current) return { ...EMPTY_LANDMARK, error: "That landmark no longer exists." };
  if (current.default) return current;

  const updated = await db.transaction(async (tx) => {
    await tx
      .update(landmarks)
      .set({ default: false })
      .where(and(eq(landmarks.organizationId, viewer.organizationId), eq(landmarks.default, true)));
    const [next] = await tx
      .update(landmarks)
      .set({ default: true, updatedAt: new Date() })
      .where(eq(landmarks.id, current.id))
      .returning();
    return next;
  });
  return updated;
}

const EMPTY_LANDMARK: Landmark = {
  id: "",
  name: "",
  slug: "",
  default: false,
  color: "",
  createdAt: new Date(0),
};
