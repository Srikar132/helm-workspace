import type { Node } from "@xyflow/react";
import type { WidgetNodeData } from "@/components/canvas/widget-node";
import { type WidgetLayoutItem } from "@/lib/db";
import type { BoardColumn } from "@/lib/worklog";
import type { DocProjectSummary } from "@/lib/actions/docs";
import type { AlbumPreview } from "@/lib/actions/albums";
import type { FileLibraryPreview } from "@/lib/actions/files";
import type { GmailStatus } from "@/lib/actions/gmail";
import type { GmailMessageSummary } from "@/lib/gmail";
import type { Landmark } from "@/lib/actions/landmarks";

/**
 * Single source of truth for "what widget types exist and how they behave."
 * Adding a new widget type means touching this file, not hunting through
 * canvas-shell.tsx's component body.
 */

export const MULTI_INSTANCE_WIDGET_TYPES = new Set([
  "bookmark",
  "code",
  "document",
  "draw",
  "files",
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
  "document",
  "draw",
  "files",
  "gallery",
  "landmark",
  "mail-summary",
  "markdown",
  "media",
  "project-doc",
]);
export const NON_RESIZABLE_WIDGET_TYPES = new Set(["board", "mail-summary", "bookmark", "code", "draw", "gallery", "landmark"]);

// Floor for widget types that auto-size to content (no persisted height yet)
// — without this an almost-empty note would render as a sliver. Height still
// grows past this naturally as content grows; it's a min, not a fixed size.
// Bookmark has no entry here — its content (icon + title + url) already has
// a fixed minimum height on its own, so a floor on top of that just leaves
// dead space below a card with no description.
export const AUTO_HEIGHT_MIN: Record<string, number> = { markdown: 240, "project-doc": 200, gallery: 200, document: 180, files: 220 };
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
  { id: "board-1", type: "board", x: 40, y: 220, width: 1180, height: 660 },
  { id: "mail-summary-1", type: "mail-summary", x: 1260, y: 220, width: 340, height: 420 },
];

// Height omitted for markdown — it sizes to its own content until the user
// explicitly drags a resize handle (see AUTO_HEIGHT_MIN above for the floor
// used both as its visual min-height and as a stand-in here for centering a
// fresh drop-point, since there's no real height to center on yet).
export const NEW_WIDGET_DEFAULTS: Record<string, { width: number; height?: number }> = {
  markdown: { width: 340 },
  // Height omitted — a draft URL form and a filled-out compact card (icon +
  // title + description + url, one row) are different heights, same
  // reasoning as project-doc/markdown below. Wider than the old design —
  // this is a horizontal row now, not a tall image-on-top card.
  bookmark: { width: 380 },
  // Fixed box regardless of the pasted file's real aspect ratio — the media
  // itself renders with object-fit:contain, so nothing distorts; the user
  // resizes to taste rather than the box auto-fitting the source dimensions.
  media: { width: 360, height: 280 },
  // Height omitted — sizes to content (title/description/links) like the
  // note widget, same reasoning: a draft form and a filled-out card can be
  // very different heights.
  "project-doc": { width: 320 },
  // Height omitted — same reasoning as project-doc: a draft name form and
  // a filled-out fan-card preview are different heights.
  gallery: { width: 300 },
  // Height omitted — the card grows by one line once a generated exercise gives
  // it a title, and nothing about it scrolls.
  code: { width: 320 },
  // Height omitted — the picker form is taller than the finished card (preview
  // band + filename + size), same reasoning as bookmark/project-doc above.
  document: { width: 340 },
  // Height omitted — a name form and a filled-out preview card (cover +
  // recent documents + footer) are different heights, same as gallery.
  files: { width: 300 },
  // Draft-form footprint — the creation form (pin preview + name + palette)
  // needs real room. Once saved it shrinks to the compact pin via
  // LANDMARK_PIN_SIZE in landmark-widget.tsx.
  landmark: { width: 300, height: 400 },
};

// Deliberately just plain data — no callbacks here. Mutation handlers
// (update/delete) are read by each widget itself via useCanvasActions(),
// not pre-bound at node-construction time, so building the initial node
// list never touches anything ref-backed during render.
export type WidgetNodeContext = {
  columns: BoardColumn[];
  canWrite: boolean;
  slug: string;
  initialProjectSummaries: Record<string, DocProjectSummary>;
  initialAlbumPreviews: Record<string, AlbumPreview>;
  initialLibraryPreviews: Record<string, FileLibraryPreview>;
  initialGmailStatus: GmailStatus;
  initialGmailMessages?: GmailMessageSummary[];
  /** Server-prefetched landmarks, keyed by landmark id — same batching
   *  precedent as initialProjectSummaries above. */
  initialLandmarks?: Record<string, Landmark>;
};

/**
 * Whether this widget can be resized right now.
 *
 * Type alone isn't enough: bookmark and gallery cards hug their own content and
 * shouldn't be dragged to arbitrary sizes, but both spend their first moments as
 * a FORM — several inputs that need far more room than the finished card — and a
 * form you can't resize is a form you can't fill in. So the type rule holds for a
 * saved widget and lifts while one is still a draft.
 *
 * Draft-ness is read from the live widgetData rather than baked in at
 * node-construction time, so a card stops being resizable the moment it's saved,
 * without waiting for a reload.
 */
export function isWidgetResizable(type: string, widgetData?: Record<string, unknown>): boolean {
  if (!NON_RESIZABLE_WIDGET_TYPES.has(type)) return true;
  return isDraftWidget(type, widgetData);
}

/** True while a widget is still showing its creation form. */
function isDraftWidget(type: string, widgetData?: Record<string, unknown>): boolean {
  switch (type) {
    // A saved bookmark has both a url and a title (see asBookmarkData);
    // pendingUrl is the mid-fetch state, which is a spinner, not a form.
    case "bookmark":
      return typeof widgetData?.pendingUrl !== "string" && typeof widgetData?.url !== "string";
    case "gallery":
      return typeof widgetData?.albumId !== "string";
    case "landmark":
      return typeof widgetData?.landmarkId !== "string";
    default:
      return false;
  }
}

export function widgetTitle(type: string): string {
  switch (type) {
    case "board":
      return "Board";
    case "bookmark":
      return "Bookmark";
    case "code":
      return "Code";
    case "document":
      return "Document";
    case "files":
      return "Files";
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
 * Widget types whose height should follow their content instead of being pinned.
 *
 * These all render more than one thing: a project card becomes a five-field form
 * when edited, a bookmark is a compact row until it's a url form, a note is
 * however many lines it holds. Pinning a height meant whatever the widget was
 * measured or dragged to became a hard ceiling — so opening the edit form inside
 * a 138px-tall card crushed it, and a note could never outgrow the box it was
 * created in.
 *
 * Excluded on purpose: board, mail-summary and media want a fixed viewport with
 * their own internal scrolling, not a card that grows to the length of a list.
 */
const CONTENT_HEIGHT_TYPES = new Set(["markdown", "project-doc", "bookmark", "code", "gallery", "document", "files"]);

/**
 * A stored height is a FLOOR for these types, not a fixed size.
 *
 * Leaving the node's height undefined lets xyflow measure it, so the card grows
 * with whatever it currently renders; the stored value (what the user last
 * dragged it to) comes back as a min-height so their sizing is still respected.
 * Content decides the rest, in layout — no measuring in JS, no writing sizes back
 * while rendering, and nothing that can feed back on itself.
 */
function resolveHeight(item: WidgetLayoutItem): { height?: number; minHeight?: number } {
  if (CONTENT_HEIGHT_TYPES.has(item.type)) {
    return { height: undefined, minHeight: item.height ?? AUTO_HEIGHT_MIN[item.type] };
  }
  return { height: item.height, minHeight: item.height === undefined ? AUTO_HEIGHT_MIN[item.type] : undefined };
}

export function buildNode(item: WidgetLayoutItem, ctx: WidgetNodeContext): Node {
  const { height, minHeight } = resolveHeight(item);

  const docProjectId = item.type === "project-doc" ? (item.data?.docProjectId as string | undefined) : undefined;
  const albumId = item.type === "gallery" ? (item.data?.albumId as string | undefined) : undefined;
  const libraryId = item.type === "files" ? (item.data?.libraryId as string | undefined) : undefined;
  const landmarkId = item.type === "landmark" ? (item.data?.landmarkId as string | undefined) : undefined;

  const data: WidgetNodeData = {
    title: widgetTitle(item.type),
    canWrite: ctx.canWrite,
    minHeight,
    textEditing: TEXT_EDITING_WIDGET_TYPES.has(item.type),
    widgetType: item.type,
    widgetData: item.data,
    columns: item.type === "board" ? ctx.columns : undefined,
    // Board needs this too, to scope its query key to this workspace
    // (lib/query-keys.ts).
    slug: ctx.slug,
    initialSummary: docProjectId ? ctx.initialProjectSummaries[docProjectId] : undefined,
    initialPreview: albumId ? ctx.initialAlbumPreviews[albumId] : undefined,
    initialLibraryPreview: libraryId ? ctx.initialLibraryPreviews[libraryId] : undefined,
    initialGmailStatus: item.type === "mail-summary" ? ctx.initialGmailStatus : undefined,
    initialGmailMessages: item.type === "mail-summary" ? ctx.initialGmailMessages : undefined,
    initialLandmark: landmarkId ? ctx.initialLandmarks?.[landmarkId] : undefined,
  };

  return {
    id: item.id,
    type: "widget",
    position: item.type === "draw" ? { x: 0, y: 0 } : { x: item.x, y: item.y },
    width: item.width,
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
