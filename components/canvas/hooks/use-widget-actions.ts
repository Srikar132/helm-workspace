import type { Node } from "@xyflow/react";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { AUTO_HEIGHT_MIN, NEW_WIDGET_DEFAULTS, buildNode, type WidgetNodeContext } from "@/components/canvas/widget-registry";
import { WIDGET_SAVE_RETRY, type SaveStatus } from "@/components/canvas/hooks/use-save-status";
import { createWidgetAction, deleteWidgetAction, updateWidgetDataAction, updateWidgetSizeAction } from "@/lib/actions/widgets";
import { unwrapAction } from "@/lib/query-utils";
import { toPlainJson } from "@/lib/utils";
import type { WidgetLayoutItem } from "@/lib/db";

interface UseWidgetActionsArgs {
  ctx: WidgetNodeContext;
  setNodes: (updater: (current: Node[]) => Node[]) => void;
  saveStatus: SaveStatus;
}

/**
 * Widget CRUD — everything CanvasActionsProvider hands to individual widgets
 * (update/delete/resize/pending-file) plus `addWidget`, used by the toolbar-
 * drag and paste hooks to actually create new nodes. Each call here writes
 * exactly the one widget row it touches — no shared array to rewrite.
 */
export function useWidgetActions({ ctx, setNodes, saveStatus }: UseWidgetActionsArgs) {
  const { reportSaveFailed, reportSaveSucceeded } = saveStatus;

// Only `mutate` is destructured, deliberately: useMutation returns a NEW result
// object on every render, so a callback listing the whole mutation in its deps
// changed identity every render. That is invisible until such a callback lands in
// an effect's dependency array, where it produces an endless
// effect -> setState -> render -> effect loop. `mutate` is referentially stable,
// and naming it here keeps exhaustive-deps satisfied without reintroducing that.
  // A widget's data IS the user's work (a note's text, a bookmark's url), so
  // this gets the same retry-then-admit-it treatment as position/size rather
  // than failing to console only.
  const { mutate: saveWidgetData } = useMutation({
    ...WIDGET_SAVE_RETRY,
    mutationFn: (input: { id: string; widgetData: Record<string, unknown> }) =>
      unwrapAction(updateWidgetDataAction(input.id, input.widgetData)),
    onError: (err) => {
      console.error("Failed to save widget data:", err);
      reportSaveFailed();
    },
    onSuccess: reportSaveSucceeded,
  });

  const updateSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const latestWidgetDataRef = useRef<Map<string, Record<string, unknown>>>(new Map());

  // Guarantee 100% batch data safety — flush any pending debounced DB writes
  // before the user closes or refreshes the browser tab.
  useEffect(() => {
    const timers = updateSaveTimers.current;
    const latestData = latestWidgetDataRef.current;

    function flushPendingSaves() {
      timers.forEach((timer, id) => {
        clearTimeout(timer);
        const data = latestData.get(id);
        if (data) {
          saveWidgetData({ id, widgetData: data });
        }
      });
      timers.clear();
    }

    window.addEventListener("beforeunload", flushPendingSaves);
    return () => {
      window.removeEventListener("beforeunload", flushPendingSaves);
      flushPendingSaves();
    };
  }, [saveWidgetData]);

  const updateWidgetData = useCallback(
    (id: string, widgetData: Record<string, unknown>) => {
      // Rebuilt as plain JSON before it crosses the server-action boundary:
      // ProseMirror's mark `attrs` are null-prototype objects, which React Flight
      // cannot serialize, so a note's text colour was silently dropped in transit
      // while attribute-less marks like bold came through fine. See
      // lib/plain-json.ts.
      const plain = toPlainJson(widgetData);
      latestWidgetDataRef.current.set(id, plain);
      setNodes((current) => current.map((n) => (n.id === id ? { ...n, data: { ...n.data, widgetData: plain } } : n)));

      // Debounce DB saves for high-frequency updates (like "draw" strokes)
      // to protect Neon Postgres free tier limits from being overwhelmed
      const existingTimer = updateSaveTimers.current.get(id);
      if (existingTimer) clearTimeout(existingTimer);

      updateSaveTimers.current.set(
        id,
        setTimeout(() => {
          updateSaveTimers.current.delete(id);
          saveWidgetData({ id, widgetData: plain });
        }, 1200),
      );
    },
    [setNodes, saveWidgetData],
  );

  const { mutate: saveWidgetSize } = useMutation({
    ...WIDGET_SAVE_RETRY,
    mutationFn: (input: { id: string; width: number; height: number }) => unwrapAction(updateWidgetSizeAction(input)),
    onError: (err) => {
      console.error("Failed to save widget size:", err);
      reportSaveFailed();
    },
    onSuccess: reportSaveSucceeded,
  });

  const resizeWidget = useCallback(
    (id: string, size: { width: number; height: number }) => {
      setNodes((current) => current.map((n) => (n.id === id ? { ...n, width: size.width, height: size.height } : n)));
      saveWidgetSize({ id, ...size });
    },
    [setNodes, saveWidgetSize],
  );

  // Ephemeral interaction state, not persisted — WidgetNode drives this
  // directly off its own selected/entered state (idle -> selected arms the
  // card for a repositioning drag; interactive locks it again).
  const setWidgetDraggable = useCallback(
    (id: string, draggable: boolean) => {
      setNodes((current) =>
        current.map((n) => (n.id === id && n.draggable !== draggable ? { ...n, draggable } : n)),
      );
    },
    [setNodes],
  );

  // `useReactFlow().updateNode()` writes through xyflow's internal batch
  // queue, which gets clobbered back to stale by our own controlled `nodes`
  // prop on the next render — deselecting has to go through the same
  // `setNodes` pipeline as every other node-array write in this file.
  const setWidgetSelected = useCallback(
    (id: string, selected: boolean) => {
      setNodes((current) =>
        current.map((n) => (n.id === id && n.selected !== selected ? { ...n, selected } : n)),
      );
    },
    [setNodes],
  );

  // Pending uploads live only in memory — a raw File can't be persisted.
  // Keyed by the widget id it belongs to.
  const pendingFiles = useRef<Map<string, File>>(new Map());
  const getPendingFile = useCallback((id: string) => pendingFiles.current.get(id), []);
  const clearPendingFile = useCallback((id: string) => {
    pendingFiles.current.delete(id);
  }, []);

  const { mutate: deleteWidgetRow } = useMutation({
    mutationFn: (id: string) => unwrapAction(deleteWidgetAction(id)),
    onError: (err) => console.error("Failed to delete widget:", err),
  });

  const deleteWidget = useCallback(
    (id: string) => {
      pendingFiles.current.delete(id);
      setNodes((current) => current.filter((n) => n.id !== id));
      deleteWidgetRow(id);
    },
    [setNodes, deleteWidgetRow],
  );

  const { mutate: createWidgetRow } = useMutation({
    ...WIDGET_SAVE_RETRY,
    mutationFn: (item: WidgetLayoutItem) => unwrapAction(createWidgetAction(item)),
    onSuccess: reportSaveSucceeded,
    onError: (err, item) => {
      console.error("Failed to create widget:", err);
      reportSaveFailed();
      // The optimistic node never made it to the server — pull it back out
      // rather than leaving a widget on the canvas that doesn't exist in
      // the DB and will vanish on next reload with no explanation.
      setNodes((current) => current.filter((n) => n.id !== item.id));
    },
  });

  const addWidget = useCallback(
    (type: string, dropPoint?: { x: number; y: number }, initialData?: Record<string, unknown>) => {
      const defaults = NEW_WIDGET_DEFAULTS[type] ?? { width: 340, height: 320 };
      // dropPoint is the toolbar drag's release point (canvas coords) — the
      // widget centers there instead of anchoring its top-left corner to it.
      const x = type === "draw" ? 0 : dropPoint ? dropPoint.x - defaults.width / 2 : 60;
      const y = type === "draw" ? 0 : dropPoint ? dropPoint.y - (defaults.height ?? AUTO_HEIGHT_MIN[type] ?? 160) / 2 : 340;
      const item: WidgetLayoutItem = {
        id: `${type}-${crypto.randomUUID()}`,
        type,
        x: Math.round(x),
        y: Math.round(y),
        width: defaults.width,
        height: defaults.height,
        data: initialData,
      };
      setNodes((current) => [...current, buildNode(item, ctx)]);
      createWidgetRow(item);
      return item.id;
    },
    [ctx, setNodes, createWidgetRow],
  );

  // A pasted/dropped file becomes its own widget immediately (status:
  // "uploading"), with the File registered in `pendingFiles` under that
  // same id so MediaWidget can pick it up and start the real upload itself.
  const addMediaFiles = useCallback(
    (files: File[], dropPoint: { x: number; y: number }) => {
      files.forEach((file, i) => {
        const id = addWidget("media", { x: dropPoint.x + i * 32, y: dropPoint.y + i * 32 });
        pendingFiles.current.set(id, file);
      });
    },
    [addWidget],
  );

  return {
    updateWidgetData,
    deleteWidget,
    resizeWidget,
    setWidgetDraggable,
    setWidgetSelected,
    addWidget,
    addMediaFiles,
    getPendingFile,
    clearPendingFile,
  };
}
