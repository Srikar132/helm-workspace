import { useEffect, useRef } from "react";

const MEDIA_MIME_PATTERN = /^(image|video)\//;
// A pasted string becomes a bookmark only if it's *just* a URL — no other
// text, no whitespace/newlines. Anything else (a sentence, a URL plus a
// caption, multiple lines) becomes a note instead.
const URL_PASTE_PATTERN = /^https?:\/\/\S+$/i;

// A paste that lands in a text field or a rich-text editor belongs to that
// field, not the canvas. This listener is on `document`, so without this check
// every paste inside a widget's own input/editor ALSO spawned a stray note or
// bookmark next to it.
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], .ProseMirror"));
}

interface UseCanvasPasteArgs {
  canWrite: boolean;
  addWidget: (type: string, dropPoint?: { x: number; y: number }) => string;
  addMediaFiles: (files: File[], dropPoint: { x: number; y: number }) => void;
  updateWidgetData: (id: string, widgetData: Record<string, unknown>) => void;
  screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number };
}

/**
 * "External content enters the canvas" — pasted files become media
 * widgets, a pasted bare URL becomes a bookmark (fetching its own preview),
 * any other pasted text becomes a note; dropped files behave the same way.
 */
export function useCanvasPaste({
  canWrite,
  addWidget,
  addMediaFiles,
  updateWidgetData,
  screenToFlowPosition,
}: UseCanvasPasteArgs) {
  // Ctrl+V anywhere on the page drops pasted content at the last known
  // cursor position — a paste event carries no coordinates of its own.
  const lastPointerPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    function trackPointer(e: PointerEvent) {
      lastPointerPos.current = { x: e.clientX, y: e.clientY };
    }

    function handlePaste(e: ClipboardEvent) {
      if (!canWrite) return;
      if (e.defaultPrevented || isEditableTarget(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && MEDIA_MIME_PATTERN.test(item.type)) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) {
        e.preventDefault();
        const dropPoint = screenToFlowPosition(lastPointerPos.current);
        addMediaFiles(files, dropPoint);
        return;
      }

      // No files — a plain-text paste becomes a note, unless it's just a
      // single bare URL (no surrounding text/whitespace), in which case it
      // becomes a bookmark instead.
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;

      e.preventDefault();
      const dropPoint = screenToFlowPosition(lastPointerPos.current);
      if (URL_PASTE_PATTERN.test(text)) {
        const id = addWidget("bookmark", dropPoint);
        updateWidgetData(id, { pendingUrl: text });
      } else {
        // Handed over as raw markdown source, not a pre-built doc: parsing it
        // needs the note's own editor (its extensions decide which nodes the
        // markdown can even produce), so MarkdownWidget consumes this on mount.
        const id = addWidget("markdown", dropPoint);
        updateWidgetData(id, { pendingMarkdown: text });
      }
    }

    window.addEventListener("pointermove", trackPointer);
    document.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("pointermove", trackPointer);
      document.removeEventListener("paste", handlePaste);
    };
  }, [canWrite, addMediaFiles, addWidget, updateWidgetData, screenToFlowPosition]);

  function handleDragOverCanvas(event: React.DragEvent) {
    if (canWrite) event.preventDefault();
  }

  function handleDropOnCanvas(event: React.DragEvent) {
    if (!canWrite) return;
    const files = Array.from(event.dataTransfer.files).filter((f) => MEDIA_MIME_PATTERN.test(f.type));
    if (!files.length) return;
    event.preventDefault();
    const dropPoint = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addMediaFiles(files, dropPoint);
  }

  return { handleDragOverCanvas, handleDropOnCanvas };
}
