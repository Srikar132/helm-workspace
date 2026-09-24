"use server";

import { after } from "next/server";
import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import { db, landmarks, widgets, type WidgetLayoutItem } from "@/lib/db";
import { enqueueCloudinaryCleanup, runCleanupJobs } from "@/lib/cloudinary-cleanup";
import { requireViewerContext } from "@/lib/workspace";
import { mergeWithDefaults } from "@/components/canvas/widget-registry";
import { canWriteWidgets } from "@/lib/permissions";
import { checkDragRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { extractMentionIds } from "@/lib/mentions";
import { notifyNewMentions, widgetHref } from "@/lib/notifications";

const MAX_WIDGETS_PER_WORKSPACE = 64;

const idSchema = z.string().min(1);
const layoutItemSchema = z.object({
  id: idSchema,
  type: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().min(80),
  // Optional — a markdown note omits this until manually resized, sizing to
  // its content in the meantime.
  height: z.number().min(80).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

function rowToItem(row: { id: string; type: string; x: number; y: number; width: number; height: number | null; data: unknown }): WidgetLayoutItem {
  return {
    id: row.id,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height ?? undefined,
    data: (row.data as Record<string, unknown> | null) ?? undefined,
  };
}

/** A widget write that matches no row means the widget isn't there (deleted
 *  in another tab, or never created because its own create call failed). That
 *  used to return success, so the client kept editing against a row the server
 *  never had and the work vanished on the next reload with no error anywhere.
 *  Reporting it lets the caller retry and, failing that, surface it. */
const MISSING_WIDGET_ERROR = "That widget no longer exists — reload to get back in sync.";

/** The canvas belongs to the WORKSPACE, not to whoever created each widget:
 *  albums and doc projects were already org-scoped, and a member who can see
 *  the workspace should see the same desk as everyone else in it. Scoping these
 *  writes by userId instead used to double as the permission check — now that
 *  it doesn't, every mutation below checks `canWriteWidgets` explicitly. A
 *  stray id from another org simply matches zero rows. */
function widgetWhere(id: string, organizationId: string) {
  return and(eq(widgets.id, id), eq(widgets.organizationId, organizationId));
}

const READ_ONLY_ERROR = "You have view-only access to this workspace.";

/** Reads this user's widgets and, the first time any pinned default (board,
 *  mail-summary) is missing, inserts it — once inserted
 *  it behaves like any other widget from then on. Replaces the old
 *  "merge defaults into the in-memory array and let the next full-array
 *  save persist them" approach, which no longer exists now that saves are
 *  per-widget. */
export async function getMyWidgetLayout(): Promise<WidgetLayoutItem[]> {
  const viewer = await requireViewerContext();

  const rows = await db
    .select()
    .from(widgets)
    .where(eq(widgets.organizationId, viewer.organizationId));

  // No dedupe pass: the unique index is (id, organization_id) as of migration
  // 0013, so the database guarantees one row per widget per workspace.
  const existing = rows.map(rowToItem);
  const merged = mergeWithDefaults(existing);
  const existingIds = new Set(existing.map((item) => item.id));
  const missing = merged.filter((item) => !existingIds.has(item.id));

  if (missing.length > 0) {
    await db.insert(widgets).values(
      missing.map((item) => ({
        id: item.id,
        organizationId: viewer.organizationId,
        userId: viewer.userId,
        type: item.type,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height ?? null,
        data: item.data ?? null,
      })),
    );
  }

  return merged;
}

/** One widget by id, scoped to the viewer's workspace.
 *
 *  The code editor opens in its own browser window, so it loads server-side from
 *  the route rather than inheriting anything from the canvas — a window opened
 *  directly by URL has no canvas to inherit from. Returns undefined for an id
 *  from another workspace, which the route turns into a 404. */
export async function getWidgetById(id: string): Promise<WidgetLayoutItem | undefined> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return undefined;

  const viewer = await requireViewerContext();
  const [row] = await db
    .select()
    .from(widgets)
    .where(widgetWhere(parsedId.data, viewer.organizationId))
    .limit(1);

  return row ? rowToItem(row) : undefined;
}

export async function createWidgetAction(item: WidgetLayoutItem): Promise<{ error?: string }> {
  const parsed = layoutItemSchema.safeParse(item);
  if (!parsed.success) return { error: "Invalid widget." };

  const viewer = await requireViewerContext();
  if (!canWriteWidgets(viewer.role)) return { error: READ_ONLY_ERROR };
  const rateLimit = await checkRateLimit(`create-widget:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(widgets)
    .where(eq(widgets.organizationId, viewer.organizationId));
  if (existingCount >= MAX_WIDGETS_PER_WORKSPACE) {
    return { error: "This workspace has reached its widget limit." };
  }

  await db.insert(widgets).values({
    id: parsed.data.id,
    organizationId: viewer.organizationId,
    userId: viewer.userId,
    type: parsed.data.type,
    x: parsed.data.x,
    y: parsed.data.y,
    width: parsed.data.width,
    height: parsed.data.height ?? null,
    data: parsed.data.data ?? null,
  });

  return {};
}

const positionSchema = z.object({ id: idSchema, x: z.number(), y: z.number() });

export async function updateWidgetPositionAction(input: z.infer<typeof positionSchema>): Promise<{ error?: string }> {
  const parsed = positionSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid position." };

  const viewer = await requireViewerContext();
  if (!canWriteWidgets(viewer.role)) return { error: READ_ONLY_ERROR };
  const rateLimit = await checkDragRateLimit(`update-widget-position:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const updated = await db
    .update(widgets)
    .set({ x: parsed.data.x, y: parsed.data.y, updatedAt: new Date() })
    .where(widgetWhere(parsed.data.id, viewer.organizationId))
    .returning({ id: widgets.id });
  if (updated.length === 0) return { error: MISSING_WIDGET_ERROR };

  return {};
}

const sizeSchema = z.object({ id: idSchema, width: z.number().min(80), height: z.number().min(80).nullable() });

export async function updateWidgetSizeAction(input: z.infer<typeof sizeSchema>): Promise<{ error?: string }> {
  const parsed = sizeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid size." };

  const viewer = await requireViewerContext();
  if (!canWriteWidgets(viewer.role)) return { error: READ_ONLY_ERROR };
  const rateLimit = await checkDragRateLimit(`update-widget-size:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const updated = await db
    .update(widgets)
    .set({ width: parsed.data.width, height: parsed.data.height, updatedAt: new Date() })
    .where(widgetWhere(parsed.data.id, viewer.organizationId))
    .returning({ id: widgets.id });
  if (updated.length === 0) return { error: MISSING_WIDGET_ERROR };

  return {};
}

export async function updateWidgetDataAction(id: string, data: Record<string, unknown>): Promise<{ error?: string }> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: "Invalid widget id." };

  const viewer = await requireViewerContext();
  if (!canWriteWidgets(viewer.role)) return { error: READ_ONLY_ERROR };
  const rateLimit = await checkDragRateLimit(`update-widget-data:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  // Mentions only live in a note's `content`. The previous value is read only
  // when the incoming one mentions anyone, so the common keystroke save costs
  // no extra query. Racing saves can both see a mention as "new" — the dedupe
  // key collapses them, so that is a wasted insert, never a duplicate.
  const nextContent = data.content;
  const prev =
    extractMentionIds(nextContent).length > 0
      ? (
          await db
            .select({ type: widgets.type, data: widgets.data })
            .from(widgets)
            .where(widgetWhere(parsedId.data, viewer.organizationId))
            .limit(1)
        )[0]
      : undefined;

  const updated = await db
    .update(widgets)
    .set({ data, updatedAt: new Date() })
    .where(widgetWhere(parsedId.data, viewer.organizationId))
    .returning({ id: widgets.id });
  if (updated.length === 0) return { error: MISSING_WIDGET_ERROR };

  if (prev?.type === "markdown") {
    after(() =>
      notifyNewMentions({
        organizationId: viewer.organizationId,
        actorId: viewer.userId,
        sourceType: "widget",
        sourceId: parsedId.data,
        prev: prev.data?.content,
        next: nextContent,
        title: "a note",
        href: (slug) => widgetHref(slug, parsedId.data),
      }),
    );
  }

  return {};
}

export async function deleteWidgetAction(id: string): Promise<{ error?: string }> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: "Invalid widget id." };

  const viewer = await requireViewerContext();
  if (!canWriteWidgets(viewer.role)) return { error: READ_ONLY_ERROR };
  const rateLimit = await checkRateLimit(`delete-widget:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  const [existing] = await db
    .select({ type: widgets.type, data: widgets.data })
    .from(widgets)
    .where(widgetWhere(parsedId.data, viewer.organizationId))
    .limit(1);
  if (!existing) return { error: MISSING_WIDGET_ERROR };

  await db.delete(widgets).where(widgetWhere(parsedId.data, viewer.organizationId));

  // A landmark widget owns its landmarks row — deleting the pin deletes the
  // named place with it (and frees its slug for reuse).
  const landmarkId =
    existing.type === "landmark"
      ? (existing.data as { landmarkId?: unknown } | null)?.landmarkId
      : undefined;
  if (typeof landmarkId === "string") {
    await db
      .delete(landmarks)
      .where(and(eq(landmarks.id, landmarkId), eq(landmarks.organizationId, viewer.organizationId)));
  }

  // A widget that owns an uploaded asset (a document today; anything else that
  // uploads later) records its Cloudinary public id in its own data. Deleting
  // only the row would leave the asset billable and reachable by URL forever,
  // so it goes through the same durable job + immediate best-effort pass the
  // album images use — the cron sweep is what actually guarantees delivery.
  const publicId = (existing.data as { cloudinaryPublicId?: unknown } | null)?.cloudinaryPublicId;
  if (typeof publicId === "string" && publicId) {
    const jobs = await enqueueCloudinaryCleanup([publicId]);
    after(() => runCleanupJobs(jobs));
  }

  return {};
}
