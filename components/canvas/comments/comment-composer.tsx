"use client";

import { useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { ArrowUp } from "lucide-react";
import { createCommentExtensions, isSuggestionActive } from "@/lib/tiptap/comment-extensions";
import { useMentionSuggestion } from "@/lib/tiptap/use-mention-suggestion";
import { commentPlainText } from "@/lib/comments";
import { cn } from "@/lib/utils";

interface CommentComposerProps {
  slug: string;
  placeholder?: string;
  /** Existing body when editing. */
  initialBody?: Record<string, unknown>;
  submitLabel?: string;
  autoFocus?: boolean;
  pending?: boolean;
  /** `clear` empties the box — call it once the post has succeeded, so a
   *  failed post keeps what was typed. */
  onSubmit: (body: Record<string, unknown>, clear: () => void) => void;
  /** Esc — and, for a draft pin, leaving it empty. */
  onCancel?: () => void;
}

/**
 * Small Tiptap editor for a comment: Enter posts, Shift+Enter breaks the line,
 * `@` opens the member picker (Enter picks a person while it's open — see
 * isSuggestionActive). Clears itself after a post.
 */
export function CommentComposer({
  slug,
  placeholder,
  initialBody,
  submitLabel = "Post",
  autoFocus,
  pending,
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  // Only members who can comment ever see a composer, so the picker's member
  // list is always wanted here.
  const mentionSuggestion = useMentionSuggestion(slug, true);
  const [extensions] = useState(() => createCommentExtensions({ placeholder, mentionSuggestion }));
  const [empty, setEmpty] = useState(!initialBody || commentPlainText(initialBody).length === 0);

  function submit(json: JSONContent) {
    if (pending || commentPlainText(json).length === 0) return;
    onSubmit(json as Record<string, unknown>, () => editor?.commands.clearContent(true));
  }

  const editor = useEditor({
    extensions,
    content: initialBody ?? "",
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: { class: "comment-editor max-h-40 overflow-y-auto px-3 py-2 text-[13px] outline-none", spellcheck: "false" },
      handleKeyDown: (view, event) => {
        if (isSuggestionActive(view.state)) return false;
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          submit(view.state.doc.toJSON() as JSONContent);
          return true;
        }
        if (event.key === "Escape" && onCancel) {
          onCancel();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => setEmpty(commentPlainText(editor.getJSON()).length === 0),
  });

  return (
    <div
      className="nopan nodrag nowheel flex items-end gap-1 rounded-xl border border-border bg-background focus-within:border-ring"
      // Keep canvas-level key handlers (widget delete, paste) out of the editor.
      onKeyDown={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
    >
      <EditorContent editor={editor} className="min-w-0 flex-1" />
      <button
        type="button"
        aria-label={submitLabel}
        title={submitLabel}
        disabled={empty || pending}
        onClick={() => editor && submit(editor.getJSON())}
        className={cn(
          "m-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity",
          (empty || pending) && "cursor-default opacity-40",
        )}
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </div>
  );
}
