"use client";

import { NodeResizer, type NodeProps } from "@xyflow/react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useCanvasActions } from "@/components/canvas/canvas-actions-context";
import { useCanvasMode } from "@/components/canvas/canvas-mode-context";
import { WidgetChromeProvider } from "@/components/canvas/widget-chrome-context";
import { resolveWidgetChrome, widgetChromeClassName, widgetPhase } from "@/lib/canvas/widget-interaction";
import { isWidgetResizable } from "@/components/canvas/widget-registry";
import { BoardWidget } from "@/components/canvas/board-widget";
import { BookmarkWidget } from "@/components/canvas/bookmark-widget";
import { CodeWidget } from "@/components/canvas/code-widget";
import { DrawWidget } from "@/components/canvas/draw-widget";
import { GalleryWidget } from "@/components/canvas/gallery-widget";
import { MailSummaryWidget } from "@/components/canvas/mail-summary-widget";
import { MediaWidget } from "@/components/canvas/media-widget";
import { ProjectDocWidget } from "@/components/canvas/project-doc-widget";
import type { BoardColumn } from "@/lib/worklog";
import type { DocProjectSummary } from "@/lib/actions/docs";
import type { AlbumPreview } from "@/lib/actions/albums";
import type { GmailStatus } from "@/lib/actions/gmail";
import type { GmailMessageSummary } from "@/lib/gmail";
import type { Landmark } from "@/lib/actions/landmarks";
import { LandmarkWidget } from "./landmark-widget";

// Tiptap + its extensions (table, task-list, etc.) is the heaviest single
// widget dependency and, unlike board/mail-summary, genuinely optional —
// not every canvas has a note on it. Split out rather than paying for it
// on every canvas open regardless of whether a note widget exists.
const MarkdownWidget = dynamic(() => import("@/components/canvas/markdown-widget").then((m) => m.MarkdownWidget), {
  ssr: false,
});

export type WidgetNodeData = {
  /** No visible header anymore — used as a native `title` tooltip on hover. */
  title: string;
  canWrite: boolean;
  /** Content-driven height floor, in px — see widget-registry's AUTO_HEIGHT_MIN.
   *  Applied directly on the card's own container, not an ancestor:
   *  min-height on a percentage-sized ancestor doesn't stretch percentage
   *  children to fill it (they resolve as `auto` per spec), so the floor
   *  has to live on the box that actually needs to grow. */
  minHeight?: number;
  /** This widget owns a text caret, so it needs the `editing` phase: inside it
   *  a drag must select characters, which conflicts with dragging to
   *  reposition. Everything else is interactive from the first click and needs
   *  no phase of its own. */
  textEditing?: boolean;
  widgetType: string;
  widgetData?: Record<string, unknown>;
  /** Only populated for type "board". */
  columns?: BoardColumn[];
  /** Populated for "project-doc"/"gallery" (the MANAGE/OPEN GALLERY link) and
   *  for "board", which needs it to scope its query key to this workspace. */
  slug?: string;
  /** Server-prefetched — batched once for every project-doc card on the
   *  canvas rather than each one fetching its own on mount. */
  initialSummary?: DocProjectSummary;
  /** Server-prefetched — batched once for every gallery card on the canvas,
   *  same precedent as initialSummary above. */
  initialPreview?: AlbumPreview;
  /** Server-prefetched — only populated for type "mail-summary". */
  initialGmailStatus?: GmailStatus;
  initialGmailMessages?: GmailMessageSummary[];
  /** Only populated for type "landmarks". */
  initialLandmark?: Landmark;
};

// Dispatches on the node's OWN live `data` prop rather than a closure baked
// in at node-creation time — a closure captured once would never see later
// updates from updateWidgetData (this bit media widgets: upload completion
// updates data.widgetData, but a frozen `render()` closure kept showing the
// original "uploading" snapshot forever).
function renderWidgetBody(id: string, data: WidgetNodeData): React.ReactNode {
  switch (data.widgetType) {
    case "board":
      return <BoardWidget slug={data.slug ?? ""} columns={data.columns ?? []} canWrite={data.canWrite} />;
    case "bookmark":
      return <BookmarkWidget id={id} canWrite={data.canWrite} widgetData={data.widgetData} />;
    case "code":
      return <CodeWidget id={id} slug={data.slug ?? ""} canWrite={data.canWrite} widgetData={data.widgetData} />;
    case "draw":
      return <DrawWidget id={id} canWrite={data.canWrite} widgetData={data.widgetData} />;
    case "gallery": {
      const albumId = data.widgetData?.albumId;
      return (
        <GalleryWidget
          id={id}
          albumId={typeof albumId === "string" ? albumId : undefined}
          slug={data.slug}
          canWrite={data.canWrite}
          initialPreview={data.initialPreview}
        />
      );
    }
    case "mail-summary":
      return (
        <MailSummaryWidget
          initialStatus={data.initialGmailStatus}
          initialMessages={data.initialGmailMessages}
        />
      );
    case "markdown":
      return <MarkdownWidget id={id} initialContent={data.widgetData} canWrite={data.canWrite} />;
    case "media":
      return <MediaWidget id={id} data={data.widgetData} canWrite={data.canWrite} />;
    case "project-doc": {
      const docProjectId = data.widgetData?.docProjectId;
      return (
        <ProjectDocWidget
          id={id}
          docProjectId={typeof docProjectId === "string" ? docProjectId : undefined}
          slug={data.slug}
          canWrite={data.canWrite}
          initialSummary={data.initialSummary}
        />
      );
    }
    case "landmark": {
      const landmarkId = data.widgetData?.landmarkId;
      return (
        <LandmarkWidget
          id={id}
          canWrite={data.canWrite}
          initialLandmark={data.initialLandmark}
          landmarkId={typeof landmarkId === "string" ? landmarkId : undefined}
        />
      );
    }
    default:
      return null;
  }
}

// Fully invisible — the selected/entered ring highlight (rendered on the
// card itself) is the only visual affordance; the actual drag hit-areas
// (all 4 edges + 4 corners) sit right on top of that ring, transparent.
// Must be the LAST child in DOM order, after the card content, or the
// content div (same size, no z-index) paints over it and swallows every
// pointer event except the exact corner pixel the content's own border
// radius happens to leave uncovered.
// Sizes are set via style (not className) so they win regardless of
// Tailwind specificity — generous on purpose: `autoScale` keeps this a
// fixed screen size at any zoom level, so it has to be big enough to grab
// comfortably even zoomed all the way out.
const RESIZE_LINE_CLASS = "!border-transparent";
const RESIZE_LINE_STYLE = { borderWidth: 10 };
const RESIZE_HANDLE_CLASS = "!border-none !bg-transparent";
const RESIZE_HANDLE_STYLE = { width: 22, height: 22 };
const RESIZE_MIN_WIDTH = 160;
const RESIZE_MIN_HEIGHT = 100;

export function WidgetNode({ id, data, selected }: NodeProps) {
  const widgetData = data as unknown as WidgetNodeData;
  const { title, minHeight, textEditing = false } = widgetData;
  // Derived from live widgetData, not a flag frozen at node construction — a
  // bookmark/gallery draft is resizable while its form is up and stops being so
  // once saved (see isWidgetResizable).
  const resizable = isWidgetResizable(widgetData.widgetType, widgetData.widgetData);
  const [editing, setEditing] = useState(false);
  const [enterPoint, setEnterPoint] = useState<{ x: number; y: number } | null>(null);
  const [floatingToolbar, setFloatingToolbar] = useState<React.ReactNode | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { setWidgetDraggable, setWidgetSelected } = useCanvasActions();
  const { mode } = useCanvasMode();

  const phase = widgetPhase({ selected, editing });
  const chrome = resolveWidgetChrome(mode, phase, { resizable });

  // xyflow attaches its own node-drag handler only when `draggable` is true,
  // so this one flag is the whole reposition mechanism.
  useEffect(() => {
    setWidgetDraggable(id, chrome.draggable);
  }, [id, chrome.draggable, setWidgetDraggable]);

  // Leaving a widget: clicking anywhere outside it, or Escape, drops back to
  // idle and deselects. Deselecting has to be explicit — clicks on UI outside
  // xyflow's own DOM (the toolbar, workspace chrome) never reach its
  // pane-click deselect.
  useEffect(() => {
    if (!editing && !selected) return;

    function exitToIdle() {
      setEditing(false);
      setEnterPoint(null);
      setWidgetSelected(id, false);
    }

    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        exitToIdle();
      }
    }
    // Capture phase, not bubble — a rich-text widget's own editor (Tiptap/
    // ProseMirror) has its own Escape handling and can stop the event from
    // ever reaching a bubble-phase document listener. Capture runs before
    // the event reaches that editor at all, so it can't be swallowed.
    //
    // stopPropagation matters here beyond just our own editor: xyflow's own
    // node wrapper also has an Escape handler (for its own selection model),
    // and its handleNodeClick has a quirk — if the node is already
    // deselected by the time it runs, it ignores "unselect" and *selects*
    // the node instead (its guard only checks unselect when already
    // selected). Since our exitToIdle deselects first, letting the event
    // continue to that handler re-selects the node right back. Stopping
    // propagation here keeps xyflow's own node-level handling from ever
    // seeing this keypress.
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        exitToIdle();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [editing, selected, id, setWidgetSelected]);

  // Media has no background of its own (the image/video fills the card);
  // every other type needs one to actually read as a card now that none of
  // them have a bordered/bg'd header container anymore. Markdown keeps its
  // user-customizable override.
  const cardBg =
    widgetData.widgetType === "media"
      ? undefined
      : (widgetData.widgetData?.bgColor as string | undefined);

  // Landmarks are pins standing ON the canvas, not cards sitting on it — no
  // shell background, border or selection rectangle around mostly-empty space.
  // The functional chrome (drag gating, cursors, pointer-events) still applies;
  // only the visual card treatment is skipped. The draft form paints its own
  // containment while it exists.
  const chromeless = widgetData.widgetType === "landmark";

  if (widgetData.widgetType === "draw") {
    return <DrawWidget id={id} canWrite={widgetData.canWrite} widgetData={widgetData.widgetData} />;
  }

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full"
      title={title}
      onDoubleClick={(e) => {
        // Only text-editing widgets have an `editing` phase to enter; for the
        // rest the body is already live, and entering would just take their
        // resize controls away.
        if (!textEditing) return;
        setEditing(true);
        setEnterPoint({ x: e.clientX, y: e.clientY });
      }}
    >
      <div
        style={{ ...(minHeight && !chromeless ? { minHeight } : undefined), ...(cardBg ? { backgroundColor: cardBg } : undefined) }}
        className={`h-full w-full touch-manipulation ${chromeless ? "" : "widget-card-shell overflow-hidden transition-all"} ${widgetChromeClassName(chrome, chromeless ? "idle" : phase)}`}
      >
        <WidgetChromeProvider value={{ editing, enterPoint, setFloatingToolbar }}>
          {renderWidgetBody(id, widgetData)}
        </WidgetChromeProvider>
      </div>

      {/* Toolbar sits above the card, outside its overflow-hidden clip —
          per-card, not one shared canvas-wide bar. */}
      {editing && floatingToolbar && (
        <div className="nodrag absolute inset-x-0 bottom-full z-10 mb-2 flex justify-center">
          {floatingToolbar}
        </div>
      )}

      {chrome.showResizeControls && (
        <NodeResizer
          minWidth={RESIZE_MIN_WIDTH}
          minHeight={RESIZE_MIN_HEIGHT}
          lineClassName={RESIZE_LINE_CLASS}
          lineStyle={RESIZE_LINE_STYLE}
          handleClassName={RESIZE_HANDLE_CLASS}
          handleStyle={RESIZE_HANDLE_STYLE}
        />
      )}
    </div>
  );
}
