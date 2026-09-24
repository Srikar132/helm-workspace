"use client";

import { useEditor, EditorContent, type Editor, type JSONContent } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { createNoteExtensions } from "@/lib/tiptap/note-extensions";
import { useMentionSuggestion } from "@/lib/tiptap/use-mention-suggestion";

const SAVE_DEBOUNCE_MS = 600;

interface TiptapEditorProps {
  content?: Record<string, unknown> | null;
  onChange?: (json: JSONContent) => void;
  editable: boolean;
  placeholder?: string;
  /** Applied to the EditorContent wrapper — lets each caller (canvas note vs
   *  docs page sheet) own its own typography/width without this component
   *  needing to know which context it's in. */
  className?: string;
  /** Fires when this editor gains focus — the docs route uses this to know
   *  which page's editor the single global toolbar should act on. */
  onFocusEditor?: (editor: Editor) => void;
  /** Workspace slug — enables the `@` picker. Absent on the public share page. */
  slug?: string;
}

/** Presentational Tiptap setup shared by the canvas markdown widget's spirit
 *  and the docs route's page editor — no canvas-specific context deps
 *  (unlike components/canvas/markdown-widget.tsx, which stays as-is and
 *  reads useWidgetChrome/useCanvasActions directly), and no toolbar of its
 *  own — the docs route renders one global toolbar instead of one per page.
 *  Content scrolls continuously — pagination only happens at export/print
 *  time via the browser's own print engine, not while editing (an earlier
 *  version tried to auto-paginate live and it was never reliable — see
 *  git history if curious). */
export function TiptapEditor({ content, onChange, editable, placeholder, className, onFocusEditor, slug }: TiptapEditorProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mentionSuggestion = useMentionSuggestion(slug, editable);

  const editor = useEditor({
    extensions: createNoteExtensions({ placeholder: placeholder ?? "Write something…", mentionSuggestion }),
    content: content ?? "",
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: { spellcheck: "false" },
    },
    onFocus: ({ editor }) => onFocusEditor?.(editor),
    onUpdate: ({ editor }) => {
      // A read-only editor has nothing to persist; anything that still emits an
      // update here (an extension normalising content, a programmatic command)
      // must not turn into a save the server will reject.
      if (!editor.isEditable) return;
      if (onChange) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          onChange(editor.getJSON());
        }, SAVE_DEBOUNCE_MS);
      }
    },
  });

  useEffect(() => {
    // Second arg suppresses setEditable's own "update" event. Without it, just
    // mounting (or flipping editable) emits an update, which fired onChange and
    // saved every page on open — a wasted write for an owner, and a rejected
    // "View-only access." save for an invited member who only opened the doc.
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  if (!editor) return null;

  return <EditorContent editor={editor} className={className ?? "prose-note h-full"} />;
}
