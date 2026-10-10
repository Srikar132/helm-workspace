import type { Node } from "@xyflow/react";
import type { WidgetNodeData } from "@/components/canvas/widget-node";
import { type WidgetLayoutItem } from "@/lib/db";
import type { BoardColumn } from "@/lib/worklog";
import type { DocProjectSummary } from "@/lib/actions/docs";
import type { GalleryPreview } from "@/lib/actions/galleries";
import type { GmailStatus } from "@/lib/actions/gmail";
import type { GmailMessageSummary } from "@/lib/gmail";
import type { Landmark } from "@/lib/actions/landmarks";
import { defaultSize, storedSize } from "@/lib/canvas/widget-sizing";

/**
 * Single source of truth for "what widget types exist and how they behave."
 * Adding a new widget type means touching this file, not hunting through
 * canvas-shell.tsx's component body.
 */

export const MULTI_INSTANCE_WIDGET_TYPES = new Set([
  "bookmark",
  "code",
  "draw",
  "gallery",
  "landmark",
  "markdown",
  "media",
  "project-doc",
]);
export const KNOWN_WIDGET_TYPES = new Set([
  "board",
  "bookmark",
  "code",
  "draw",
  "gallery",
  "landmark",
  "mail-summary",
  "markdown",
  "media",
  "project-doc",
]);
// Widgets that own a text caret. These are the only ones with an `editing`
// phase, because they're the only ones where a drag is ambiguous: inside text
// it must select characters, on the card it must reposition. Every other
// widget (media controls, board inputs, links, buttons) is simply live from
// the first click in `select` mode — see lib/canvas/widget-interaction.ts.
export const TEXT_EDITING_WIDGET_TYPES = new Set(["markdown"]);

// Fixed 3-column board — wide enough that all three "To Do / In Progress /
// Completed" columns are visible without horizontal scroll on a typical
// desktop viewport. Mail summary sits beside it — fully self-contained, it
// fetches/manages its own data and takes no props from the canvas.
// Workspace settings used to be pinned here as a third card; it lives at
// /workspace/[slug]/settings now, reachable from the avatar menu. Dropping the
// type from KNOWN_WIDGET_TYPES is what retires the existing rows: mergeWithDefaults
// filters out anything whose type it no longer recognises, so saved copies stop
// appearing without needing a data migration.
export const DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { id: "board-1", type: "board", x: 40, y: 220, ...defaultSize("board") },
  { id: "mail-summary-1", type: "mail-summary", x: 1260, y: 220, ...defaultSize("mail-summary") },
];

// Deliberately just plain data — no callbacks here. Mutation handlers
// (update/delete) are read by each widget itself via useCanvasActions(),
// not pre-bound at node-construction time, so building the initial node
// list never touches anything ref-backed during render.
export type WidgetNodeContext = {
  columns: BoardColumn[];
  canWrite: boolean;
  slug: string;
  initialProjectSummaries: Record<string, DocProjectSummary>;
  initialGalleryPreviews: Record<string, GalleryPreview>;
  initialGmailStatus: GmailStatus;
  initialGmailMessages?: GmailMessageSummary[];
  /** Server-prefetched landmarks, keyed by landmark id — same batching
   *  precedent as initialProjectSummaries above. */
  initialLandmarks?: Record<string, Landmark>;
};

export function widgetTitle(type: string): string {
  switch (type) {
    case "board":
      return "Board";
    case "bookmark":
      return "Bookmark";
    case "code":
      return "Code";
    case "gallery":
      return "Gallery";
    case "mail-summary":
      return "Today's Mail";
    case "markdown":
      return "Note";
    case "media":
      return "Media";
    case "project-doc":
      return "Project";
    case "landmark":
      return "Landmark";
    default:
      return type;
  }
}

/**
 * A widget's node is exactly its stored size (see lib/canvas/widget-sizing.ts):
 * explicit width and height, which xyflow treats as the size, never as a hint
 * to be re-measured. A row saved before heights were always stored falls back to
 * the type's settled size.
 */
export function buildNode(item: WidgetLayoutItem, ctx: WidgetNodeContext): Node {
  const { width, height } = storedSize(item.type, item.width, item.height);

  const docProjectId = item.type === "project-doc" ? (item.data?.docProjectId as string | undefined) : undefined;
  const galleryId = item.type === "gallery" ? (item.data?.galleryId as string | undefined) : undefined;
  const landmarkId = item.type === "landmark" ? (item.data?.landmarkId as string | undefined) : undefined;

  const data: WidgetNodeData = {
    title: widgetTitle(item.type),
    canWrite: ctx.canWrite,
    textEditing: TEXT_EDITING_WIDGET_TYPES.has(item.type),
    widgetType: item.type,
    widgetData: item.data,
    columns: item.type === "board" ? ctx.columns : undefined,
    // Board needs this too, to scope its query key to this workspace
    // (lib/query-keys.ts).
    slug: ctx.slug,
    initialSummary: docProjectId ? ctx.initialProjectSummaries[docProjectId] : undefined,
    initialPreview: galleryId ? ctx.initialGalleryPreviews[galleryId] : undefined,
    initialGmailStatus: item.type === "mail-summary" ? ctx.initialGmailStatus : undefined,
    initialGmailMessages: item.type === "mail-summary" ? ctx.initialGmailMessages : undefined,
    initialLandmark: landmarkId ? ctx.initialLandmarks?.[landmarkId] : undefined,
  };

  return {
    id: item.id,
    type: "widget",
    position: item.type === "draw" ? { x: 0, y: 0 } : { x: item.x, y: item.y },
    width,
    height,
    dragHandle: undefined,
    // WidgetNode owns this from here on, derived from the canvas mode and the
    // widget's phase (lib/canvas/widget-interaction.ts). Starting false means
    // the first frame — before that effect runs — can't accidentally drag.
    draggable: false,
    data: data as unknown as Record<string, unknown>,
  };
}

/**
 * Any default widget type the user doesn't already have gets appended (at its
 * default position) — otherwise a newly-introduced default widget would
 * silently never show up for someone whose layout was already saved before it
 * existed. Widgets they already have keep whatever position/size they last
 * left them at. Anything saved whose type is no longer known (a widget that's
 * since been removed) is dropped — it'll simply stop appearing, and the next
 * save naturally stops persisting it. Multi-instance types (like markdown
 * notes) are exempt from the "add if missing" step — having zero of them is
 * the normal starting state, not something to backfill.
 */
export function mergeWithDefaults(saved: WidgetLayoutItem[] | null): WidgetLayoutItem[] {
  const layout = (saved ?? []).filter((item) => KNOWN_WIDGET_TYPES.has(item.type));
  const existingTypes = new Set(layout.map((item) => item.type));
  for (const def of DEFAULT_LAYOUT) {
    if (!MULTI_INSTANCE_WIDGET_TYPES.has(def.type) && !existingTypes.has(def.type)) {
      layout.push(def);
    }
  }
  return layout;
}
