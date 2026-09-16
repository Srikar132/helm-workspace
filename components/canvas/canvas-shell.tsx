"use client";

import "@xyflow/react/dist/style.css";
import { ReactFlow, ReactFlowProvider, Controls, MiniMap, useReactFlow } from "@xyflow/react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { FileLibraryPreview } from "@/lib/actions/files";
import type { GmailStatus } from "@/lib/actions/gmail";
import type { GmailMessageSummary } from "@/lib/gmail";

const nodeTypes = { widget: WidgetNode };

interface CanvasShellProps {
  slug: string;
  initialLayout: WidgetLayoutItem[];
  columns: BoardColumn[];
  canWrite: boolean;
  initialProjectSummaries: Record<string, DocProjectSummary>;
  initialAlbumPreviews: Record<string, AlbumPreview>;
  initialLibraryPreviews: Record<string, FileLibraryPreview>;
  initialGmailStatus: GmailStatus;
  initialGmailMessages?: GmailMessageSummary[];
}

function CanvasInner({
  slug,
  initialLayout,
  columns,
  canWrite,
  initialProjectSummaries,
  initialAlbumPreviews,
  initialLibraryPreviews,
  initialGmailStatus,
  initialGmailMessages,
}: CanvasShellProps) {
  const ctx: WidgetNodeContext = useMemo(
    () => ({
      columns,
      canWrite,
      slug,
      initialProjectSummaries,
      initialAlbumPreviews,
      initialLibraryPreviews,
      initialGmailStatus,
      initialGmailMessages,
    }),
    [
      columns,
      canWrite,
      slug,
      initialProjectSummaries,
      initialAlbumPreviews,
      initialLibraryPreviews,
      initialGmailStatus,
      initialGmailMessages,
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
    addFiles,
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

  const { screenToFlowPosition } = useReactFlow();
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
    addFiles,
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
            fitView
            fitViewOptions={{ padding: 0.15 }}
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
            <MiniMap className="hidden !rounded-xl !border !border-white/[0.06] md:block" />
          </ReactFlow>
          <DrawCanvasOverlay />
        </div>
      </CanvasActionsProvider>

      <CanvasModeToolbar />
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
  );
}

export function CanvasShell(props: CanvasShellProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
