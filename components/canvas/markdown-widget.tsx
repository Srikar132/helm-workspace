"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeMarkdownSource } from "@/lib/tiptap/markdown-signal";
import { createNoteExtensions } from "@/lib/tiptap/note-extensions";
import { useMentionSuggestion } from "@/lib/tiptap/use-mention-suggestion";
import { useWidgetChrome } from "@/components/canvas/widget-chrome-context";
import { useCanvasActions } from "@/components/canvas/canvas-actions-context";
import { NoteToolbar } from "@/components/canvas/note-toolbar";

const SAVE_DEBOUNCE_MS = 600;

interface MarkdownWidgetProps {
  id: string;
  initialContent?: Record<string, unknown>;
  canWrite: boolean;
  slug?: string;
}

/** Chromeless — no header, no grip icon. While entered, pushes its own
 *  formatting toolbar up to WidgetNode via setFloatingToolbar, which renders
 *  it just above this card (outside its clip) — one toolbar per note. */
// Older notes stored the raw Tiptap doc directly as widgetData; notes saved
// after the card-background feature wrap it as { content, bgColor } instead
// — detect a raw doc by its "type": "doc" field to stay compatible with both.
function isWrappedData(
  data: Record<string, unknown>,
): data is { content?: Record<string, unknown>; bgColor?: string; pendingMarkdown?: string } {
  return data.type !== "doc";
}

export function MarkdownWidget({ id, initialContent, canWrite, slug }: MarkdownWidgetProps) {
  const { editing, enterPoint, setFloatingToolbar } = useWidgetChrome();
  const { updateWidgetData, deleteWidget } = useCanvasActions();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every editor transaction so bold/italic/etc. active-state
  // highlighting in the toolbar follows the live cursor.
  const [, forceRender] = useState(0);

  const wrapped = initialContent && isWrappedData(initialContent) ? initialContent : undefined;
  const initialDoc = wrapped ? wrapped.content : initialContent;
  const [bgColor, setBgColor] = useState<string | undefined>(wrapped?.bgColor);
  // Set by a canvas paste (use-canvas-paste.ts) — raw markdown source that
  // only this editor can parse, since its extension set is what decides which
  // nodes (tables, task lists, ...) the markdown is allowed to produce.
  const pendingMarkdown = typeof wrapped?.pendingMarkdown === "string" ? wrapped.pendingMarkdown : undefined;
  const consumedPendingMarkdown = useRef(false);

  const mentionSuggestion = useMentionSuggestion(slug, canWrite);

  const editor = useEditor({
    extensions: createNoteExtensions({ mentionSuggestion }),
    content: initialDoc ?? "",
    editable: editing && canWrite,
    immediatelyRender: false,
    editorProps: {
      attributes: { spellcheck: "false" },
    },
    onUpdate: ({ editor }) => {
      // A view-only member can still trigger editor commands (Tiptap's
      // `editable` blocks typing, not programmatic commands), and the server
      // rightly refuses the write. Bailing here means their formatting never
      // looks like it worked for a second and then vanishes on reload.
      if (!canWrite) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        updateWidgetData(id, { content: editor.getJSON(), bgColor });
      }, SAVE_DEBOUNCE_MS);
    },
    onTransaction: () => forceRender((n) => n + 1),
  });

  const handleBgColorChange = useCallback(
    (color: string | undefined) => {
      if (!canWrite) return;
      setBgColor(color);
      if (editor) updateWidgetData(id, { content: editor.getJSON(), bgColor: color });
    },
    [canWrite, editor, id, updateWidgetData],
  );

  useEffect(() => {
    if (!editor || !pendingMarkdown || consumedPendingMarkdown.current) return;
    consumedPendingMarkdown.current = true;
    editor.commands.setContent(normalizeMarkdownSource(pendingMarkdown), { contentType: "markdown" });
    updateWidgetData(id, { content: editor.getJSON(), bgColor });
  }, [editor, pendingMarkdown, id, bgColor, updateWidgetData]);

  useEffect(() => {
    // Second arg suppresses setEditable's own "update" event — without it,
    // just entering/exiting the note (which flips editable) fires onUpdate
    // and queues a save even though nothing was actually typed.
    editor?.setEditable(editing && canWrite, false);
  }, [editor, editing, canWrite]);

  // The double-click/tap that entered the note landed on a
  // `pointer-events-none` body, so ProseMirror never saw it and the caret
  // would otherwise sit at the start of the document no matter where the user
  // aimed. Replay that point as a real text position. Runs after the
  // setEditable effect above on purpose — focusing a non-editable view puts
  // the caret nowhere.
  useEffect(() => {
    if (!editor || !editing || !canWrite) return;
    const pos = enterPoint ? editor.view.posAtCoords({ left: enterPoint.x, top: enterPoint.y }) : null;
    editor.commands.focus(pos ? pos.pos : "end");
  }, [editor, editing, canWrite, enterPoint]);

  useEffect(() => {
    // canWrite, not just editing: a view-only member could enter the note (to
    // select and copy text, which is reasonable) and was handed the whole
    // formatting toolbar, every button of which applied a mark locally that the
    // server then refused to save. This is what made "colour doesn't work" look
    // like a colour bug.
    if (!editing || !editor || !canWrite) {
      setFloatingToolbar(null);
      return;
    }
    setFloatingToolbar(
      <NoteToolbar
        editor={editor}
        bgColor={bgColor}
        onBgColorChange={handleBgColorChange}
        onDelete={() => deleteWidget(id)}
      />,
    );
    return () => setFloatingToolbar(null);
  }, [editing, editor, canWrite, id, bgColor, deleteWidget, handleBgColorChange, setFloatingToolbar]);

  if (!editor) return null;

  return (
    // nodrag/nowheel/cursor all come from the card shell's chrome (see
    // lib/canvas/widget-interaction.ts) — they apply to descendants, so
    // restating them here would just be a second copy of the same rules.
    <div className="h-full min-h-0 flex-1 overflow-y-auto scrollbar-thin px-3 py-2">
      <EditorContent editor={editor} className="prose-note h-full text-[13.5px] text-[#e8eaed]" />
    </div>
  );
}
