"use client";

import "@xyflow/react/dist/style.css";
import { ReactFlow, ReactFlowProvider, useReactFlow, type ReactFlowInstance } from "@xyflow/react";

import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { WidgetNode, type WidgetNodeData } from "@/components/canvas/widget-node";
import { WidgetToolbar, ToolbarDragGhost } from "@/components/canvas/widget-toolbar";
import { CanvasModeToolbar } from "@/components/canvas/canvas-mode-toolbar";
import { CanvasModeProvider } from "@/components/canvas/canvas-mode-context";
import { CanvasActionsProvider } from "@/components/canvas/canvas-actions-context";
import { DrawCanvasOverlay } from "@/components/canvas/draw-canvas-overlay";
import { CANVAS_CLASS_BY_MODE, FLOW_PROPS_BY_MODE, type CanvasMode } from "@/lib/canvas/widget-interaction";
import type { DrawTool, Stroke } from "@/lib/canvas/stroke-utils";
import { useWidgetLayout } from "@/components/canvas/hooks/use-widget-layout";
import { useWidgetActions } from "@/components/canvas/hooks/use-widget-actions";
import { useSaveStatus } from "@/components/canvas/hooks/use-save-status";
import { useToolbarDrag } from "@/components/canvas/hooks/use-toolbar-drag";
import { useCanvasPaste } from "@/components/canvas/hooks/use-canvas-paste";
import type { WidgetNodeContext } from "@/components/canvas/widget-registry";
import type { WidgetLayoutItem } from "@/lib/db";
import type { BoardColumn } from "@/lib/worklog";
import type { DocProjectSummary } from "@/lib/actions/docs";
import type { AlbumPreview } from "@/lib/actions/albums";
import type { GmailStatus } from "@/lib/actions/gmail";
import type { GmailMessageSummary } from "@/lib/gmail";
import { Landmark } from "@/lib/actions/landmarks";
import {
  CanvasCommentsContext,
  useCanvasCommentsState,
  type CanvasCommentsConfig,
} from "@/components/canvas/comments/canvas-comments-context";
import { CommentLayer } from "@/components/canvas/comments/comment-layer";

const nodeTypes = { widget: WidgetNode };

interface CanvasShellProps {
  slug: string;
  initialLayout: WidgetLayoutItem[];
  columns: BoardColumn[];
  canWrite: boolean;
  initialProjectSummaries: Record<string, DocProjectSummary>;
  initialAlbumPreviews: Record<string, AlbumPreview>;
  initialGmailStatus: GmailStatus;
  initialGmailMessages?: GmailMessageSummary[];
  initialLandmarks: Record<string, Landmark>;
  /** The workspace's HOME landmark — the canvas opens centered on it. */
  initialDefaultLandmark?: Landmark | null;
  comments: CanvasCommentsConfig;
}

function CanvasInner({
  slug,
  initialLayout,
  columns,
  canWrite,
  initialProjectSummaries,
  initialAlbumPreviews,
  initialGmailStatus,
  initialGmailMessages,
  initialLandmarks,
  initialDefaultLandmark,
  comments,
}: CanvasShellProps) {
  const ctx: WidgetNodeContext = useMemo(
    () => ({
      columns,
      canWrite,
      slug,
      initialProjectSummaries,
      initialAlbumPreviews,
          initialGmailStatus,
      initialGmailMessages,
      initialLandmarks,
    }),
    [
      columns,
      canWrite,
      slug,
      initialProjectSummaries,
      initialAlbumPreviews,
          initialGmailStatus,
      initialGmailMessages,
      initialLandmarks,
    ],
  );

  // One save-failure signal for every widget write — content, position and
  // size alike (see use-save-status.ts).
  const saveStatus = useSaveStatus();
  const { nodes, setNodes, onNodesChange } = useWidgetLayout(initialLayout, ctx, saveStatus);
  const {
    updateWidgetData,
    deleteWidget,
    resizeWidget,
    setWidgetDraggable,
    setWidgetSelected,
    addWidget,
    addMediaFiles,
    getPendingFile,
    clearPendingFile,
  } = useWidgetActions({ ctx, setNodes, saveStatus });

  // Grab is the default — opening a canvas starts by looking around it, and a
  // stray first drag pans instead of marquee-selecting or nudging a widget.
  const [mode, setMode] = useState<CanvasMode>("grab");
  const [activeTool, setActiveTool] = useState<DrawTool | "laser">("pen");
  const [strokeColor, setStrokeColor] = useState("#f7ce15");
  const [strokeWidth, setStrokeWidth] = useState(6);

  const flowProps = FLOW_PROPS_BY_MODE[mode];

  const commentsApi = useCanvasCommentsState({ slug, config: comments, mode });
  const { openThread } = commentsApi;

  const { screenToFlowPosition, setCenter } = useReactFlow();

  // Landmark coords ARE the owning widget's position (the pin is the place).
  // Smooth when the user navigates from search; instant on first paint.
  const flyToLandmark = useCallback(
    (landmarkId: string, duration?: number) => {
      const node = nodes.find(
        (n) => (n.data as unknown as WidgetNodeData).widgetData?.landmarkId === landmarkId,
      );
      if (!node) return false;
      const width = node.measured?.width ?? node.width ?? 150;
      const height = node.measured?.height ?? node.height ?? 150;
      setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: 1,
        duration,
      });
      return true;
    },
    [nodes, setCenter],
  );

  // `?focus=<widgetId>` — where a notification link wants to land.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusWidgetId = searchParams.get("focus");
  // `?thread=<id>` — a comment notification: fly to the pin, open the thread.
  const focusThreadId = searchParams.get("thread");
  const flowReady = useRef(false);

  // Consumed once, then dropped from the URL so a reload doesn't yank the view
  // back to it. Native replaceState, not router.replace: this route is
  // force-dynamic, and a router navigation would refetch the whole page
  // payload (board, mail) just to drop a query param.
  const clearFocusParam = useCallback(() => {
    window.history.replaceState(null, "", pathname);
  }, [pathname]);

  // Open at the focused widget, else HOME: decided once, at flow init — before
  // this ran in a mount effect that raced xyflow's own fitView application
  // (fitView fired after us and won, so the canvas opened fitted instead of
  // centered on HOME). No target (or its widget/pin is gone) → fit widgets.
  const handleFlowInit = useCallback(
    (instance: ReactFlowInstance) => {
      flowReady.current = true;
      const thread = focusThreadId ? comments.initialThreads.find((t) => t.id === focusThreadId) : undefined;
      if (focusThreadId) clearFocusParam();
      if (thread) {
        instance.setCenter(thread.x, thread.y, { zoom: 1 });
        openThread(thread.id);
        return;
      }
      const focused = focusWidgetId ? instance.getNode(focusWidgetId) : undefined;
      if (focusWidgetId) clearFocusParam();
      const target =
        focused ??
        (initialDefaultLandmark
          ? instance
            .getNodes()
            .find((n) => (n.data as unknown as WidgetNodeData).widgetData?.landmarkId === initialDefaultLandmark.id)
          : undefined);
      if (!target) {
        instance.fitView({ padding: 0.15 });
        return;
      }
      const width = target.measured?.width ?? target.width ?? 150;
      const height = target.measured?.height ?? target.height ?? 150;
      instance.setCenter(target.position.x + width / 2, target.position.y + height / 2, { zoom: 1 });
    },
    // Init-time only by design: later ?focus changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialDefaultLandmark],
  );

  // A notification clicked while this canvas is already open: the flow is
  // initialised, so fly there (same maths as flyToLandmark). Before init this
  // does nothing — handleFlowInit owns the first landing.
  useEffect(() => {
    if (!focusWidgetId || !flowReady.current) return;
    const node = nodes.find((n) => n.id === focusWidgetId);
    if (node) {
      const width = node.measured?.width ?? node.width ?? 150;
      const height = node.measured?.height ?? node.height ?? 150;
      setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1, duration: 400 });
    }
    clearFocusParam();
    // Keyed on the param alone: re-running on every node change would re-centre
    // on each drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusWidgetId]);

  // Same for a comment notification clicked while the canvas is open.
  useEffect(() => {
    if (!focusThreadId || !flowReady.current) return;
    const thread = commentsApi.threads.find((t) => t.id === focusThreadId);
    if (thread) {
      setCenter(thread.x, thread.y, { zoom: 1, duration: 400 });
      openThread(thread.id);
    }
    clearFocusParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusThreadId]);

  const { dndSensors, draggingType, handleDragStart, handleDragEnd } = useToolbarDrag({
    addWidget,
    screenToFlowPosition,
  });
  // Tap-to-add lands the widget in the middle of whatever the user is looking
  // at, which is the only sensible target when there is no drop point.
  const addWidgetAtViewportCenter = useCallback(
    (type: string) => {
      addWidget(type, screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
    },
    [addWidget, screenToFlowPosition],
  );

  const { handleDragOverCanvas, handleDropOnCanvas } = useCanvasPaste({
    canWrite,
    addWidget,
    addMediaFiles,
    updateWidgetData,
    screenToFlowPosition,
  });

  const widgetSummaries = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: (n.data as unknown as WidgetNodeData).widgetType,
        data: (n.data as unknown as WidgetNodeData).widgetData,
      })),
    [nodes],
  );

  const [historyStack, setHistoryStack] = useState<Stroke[][]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[][]>([]);

  const drawWidgetSummary = useMemo(
    () => widgetSummaries.find((w) => w.type === "draw"),
    [widgetSummaries],
  );

  const currentStrokes = useMemo(
    () => (drawWidgetSummary?.data?.strokes as Stroke[]) ?? [],
    [drawWidgetSummary],
  );

  const pushDrawHistory = useCallback((prevStrokes: Stroke[]) => {
    setHistoryStack((stack) => [...stack, prevStrokes]);
    setRedoStack([]);
  }, []);

  const undoDraw = useCallback(() => {
    if (historyStack.length === 0 || !drawWidgetSummary) return;
    const previousStrokes = historyStack[historyStack.length - 1];
    setHistoryStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, currentStrokes]);
    updateWidgetData(drawWidgetSummary.id, { strokes: previousStrokes });
  }, [historyStack, drawWidgetSummary, currentStrokes, updateWidgetData]);

  const redoDraw = useCallback(() => {
    if (redoStack.length === 0 || !drawWidgetSummary) return;
    const nextStrokes = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setHistoryStack((stack) => [...stack, currentStrokes]);
    updateWidgetData(drawWidgetSummary.id, { strokes: nextStrokes });
  }, [redoStack, drawWidgetSummary, currentStrokes, updateWidgetData]);

  // Keyboard shortcut listener for Ctrl+Z / Cmd+Z / Ctrl+Y
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (mode !== "draw") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          redoDraw();
        } else {
          e.preventDefault();
          undoDraw();
        }
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoDraw();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, undoDraw, redoDraw]);

  return (
    <CanvasCommentsContext.Provider value={commentsApi}>
    <DndContext id="canvas-widget-toolbar" sensors={dndSensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <CanvasModeProvider
        value={{
          mode,
          setMode,
          activeTool,
          setActiveTool,
          strokeColor,
          setStrokeColor,
          strokeWidth,
          setStrokeWidth,
          canUndo: historyStack.length > 0,
          canRedo: redoStack.length > 0,
          undoDraw,
          redoDraw,
        }}
      >
        <CanvasActionsProvider
          value={{
            widgets: widgetSummaries,
            addWidget,
            updateWidgetData,
            deleteWidget,
            pushDrawHistory,
            getPendingFile,
            clearPendingFile,
            resizeWidget,
            setWidgetDraggable,
            setWidgetSelected,
          }}
        >
          <div className="relative h-full w-full" onDragOver={handleDragOverCanvas} onDrop={handleDropOnCanvas}>
            <ReactFlow
              nodes={nodes}
              onNodesChange={onNodesChange}
              nodeTypes={nodeTypes}
              minZoom={0.3}
              maxZoom={1.5}
              onInit={handleFlowInit}
              proOptions={{ hideAttribution: true }}
              className={`bg-[#1e1f20] ${CANVAS_CLASS_BY_MODE[mode]}`}
              {...flowProps}
              // Off-screen widgets stop mounting entirely — their own data
              // fetching (useQuery, Tiptap init, etc.) doesn't fire until
              // scrolled into view, so this scales down with widget count
              // instead of fighting the fetching work already done.
              onlyRenderVisibleElements
            >
              {/* Fixed-pixel minimap eats too much of a phone screen to be
                worth the nav benefit there — hidden below md, same call
                Miro/tldraw make on mobile. */}
              {/* <MiniMap className="hidden !rounded-xl !border !border-white/[0.06] md:block" /> */}
            </ReactFlow>
            <DrawCanvasOverlay />
            <CommentLayer />
          </div>
        </CanvasActionsProvider>

        <CanvasModeToolbar addWidgetAtViewportCenter={addWidgetAtViewportCenter} flyToLandmark={flyToLandmark} />
      </CanvasModeProvider>

      <WidgetToolbar canWrite={canWrite} onAdd={addWidgetAtViewportCenter} />

      {saveStatus.saveFailed && (
        <div className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-20 -translate-x-1/2 rounded-full border border-destructive/30 bg-popover/95 px-4 py-2 text-[12.5px] text-destructive shadow-2xl backdrop-blur-md">
          Couldn&apos;t save your changes — check your connection.
        </div>
      )}

      {/* Portalled straight to <body> — DragOverlay positions itself with
          `position: fixed`, but a `transform` on any ancestor (react-flow's
          pan/zoom viewport) creates a new containing block for fixed
          descendants, which would scale/translate the ghost with the canvas
          instead of tracking the real cursor. */}
      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay>{draggingType ? <ToolbarDragGhost type={draggingType} /> : null}</DragOverlay>,
          document.body,
        )}
    </DndContext>
    </CanvasCommentsContext.Provider>
  );
}

export function CanvasShell(props: CanvasShellProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
