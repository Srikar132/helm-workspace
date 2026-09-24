import { StarterKit } from "@tiptap/starter-kit";
// Color lives in extension-text-style; @tiptap/extension-color is just a
// deprecated re-export of it.
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "@tiptap/markdown";
import { Mention, type MentionOptions } from "@tiptap/extension-mention";
import type { Extensions } from "@tiptap/core";
import { FontSize } from "@/lib/tiptap/font-size";
import { MarkdownPasteHandler } from "@/lib/tiptap/markdown-paste";

/**
 * The one extension list behind both editors (the canvas note and the docs
 * page), and the one the tests exercise.
 *
 * This list IS the schema: ProseMirror silently drops any mark attribute the
 * schema doesn't declare, so a `Color`/`FontSize` that isn't in here makes
 * `setColor`/`setFontSize` produce a bare `textStyle` mark that renders nothing
 * and saves nothing. While each editor spelled its own list out inline, a test
 * could pass against a list the app didn't actually use — so the list lives
 * here and nobody re-types it.
 */
export function createNoteExtensions({
  placeholder = "Write something…",
  mentionSuggestion,
}: {
  placeholder?: string;
  /** The `@` picker (lib/tiptap/mention-suggestion.tsx). Omitted where nobody
   *  can pick — read-only, the public share page, tests — the node stays in
   *  the schema either way, so stored mentions always render. */
  mentionSuggestion?: MentionOptions["suggestion"];
} = {}): Extensions {
  return [
    StarterKit,
    // TextStyle is the mark Color/FontSize hang their attributes off; without
    // it neither has anywhere to write to.
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    FontSize,
    Placeholder.configure({ placeholder }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    // Id-carrying @mention — the only thing the server reads when deciding
    // who to notify (lib/mentions.ts). Its markdown spec keeps id + label.
    Mention.configure({
      HTMLAttributes: { class: "mention" },
      suggestion: mentionSuggestion ?? { items: () => [] },
    }),
    // Markdown parse/serialize. Storage stays ProseMirror JSON — this only
    // engages when a caller explicitly passes contentType: "markdown".
    // breaks: a single newline is a hard break, not a paragraph continuation,
    // so pasted multi-line text keeps the lines as pasted.
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    // The extension above never engages on paste by itself — this supplies the
    // paste path (see lib/tiptap/markdown-paste.ts).
    MarkdownPasteHandler,
  ];
}
