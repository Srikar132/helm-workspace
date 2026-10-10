"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code2, Italic, Strikethrough, Underline as UnderlineIcon } from "lucide-react";

const TEXT_COLORS = [
  { label: "White", value: "#F8FAFC" },
  { label: "Blue", value: "#7DD3FC" },
  { label: "Green", value: "#86EFAC" },
  { label: "Yellow", value: "#FDE047" },
  { label: "Rose", value: "#FDA4AF" },
  { label: "Purple", value: "#D8B4FE" },
];

const BG_COLORS = [
  { label: "No highlight", value: null },
  { label: "Blue highlight", value: "rgba(59, 130, 246, 0.45)" },
  { label: "Green highlight", value: "rgba(16, 185, 129, 0.45)" },
  { label: "Amber highlight", value: "rgba(245, 158, 11, 0.45)" },
  { label: "Rose highlight", value: "rgba(244, 63, 94, 0.45)" },
  { label: "Purple highlight", value: "rgba(139, 92, 246, 0.45)" },
];

const FONT_SIZES = [
  { label: "S", value: "12px" },
  { label: "M", value: "14px" },
  { label: "L", value: "18px" },
  { label: "XL", value: "24px" },
];

/**
 * Inline formatting, attached to the text being edited — the Notion/Whimsical
 * model: marks follow the selection, so the controls are never a scroll away
 * from where the user is typing. Block-level formatting lives in the `/` menu
 * (lib/tiptap/slash-menu.tsx) and card-level settings in NoteCardChip.
 *
 * Appended to <body> with a fixed strategy: that keeps it out of xyflow's
 * zoom transform (constant on-screen size at any zoom) and out of the card's
 * overflow-hidden clip, and floating-ui flips/shifts it to stay on screen.
 */
// Module-level on purpose: BubbleMenu re-registers its ProseMirror plugin
// (which dispatches a transaction) whenever these props change identity, so
// inline literals re-rendered by a transaction listener loop forever.
const appendToBody = () => document.body;
const MENU_OPTIONS = { strategy: "fixed", placement: "top", offset: 8, flip: true, shift: { padding: 8 } } as const;
const shouldShowMenu = ({ editor: e, from, to }: { editor: Editor; from: number; to: number }) =>
  e.isEditable && from !== to && !e.state.selection.empty;

export function NoteBubbleMenu({ editor }: { editor: Editor }) {
  // Subscribes only this menu to editor state, so active-mark highlighting
  // follows the selection without re-rendering the whole note.
  useEditorState({
    editor,
    selector: ({ editor: e }) =>
      ["bold", "italic", "strike", "underline", "code"].map((m) => e.isActive(m)).join(),
  });

  return (
    <BubbleMenu
      editor={editor}
      appendTo={appendToBody}
      options={MENU_OPTIONS}
      shouldShow={shouldShowMenu}
      // Above the comment panel and canvas chrome, like the mention picker.
      style={{ zIndex: 55 }}
    >
      <div
        // Keep the editor's selection when a button is pressed.
        onMouseDown={(e) => e.preventDefault()}
        data-widget-floating
        className="flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1 rounded-2xl border border-white/[0.08] bg-[#131314]/95 px-2.5 py-1.5 shadow-2xl backdrop-blur-md"
      >
        <MarkButton title="Bold" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
          <Bold className="h-3.5 w-3.5" />
        </MarkButton>
        <MarkButton title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
          <Italic className="h-3.5 w-3.5" />
        </MarkButton>
        <MarkButton title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
          <Strikethrough className="h-3.5 w-3.5" />
        </MarkButton>
        <MarkButton title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")}>
          <UnderlineIcon className="h-3.5 w-3.5" />
        </MarkButton>
        <MarkButton title="Code" onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")}>
          <Code2 className="h-3.5 w-3.5" />
        </MarkButton>

        <Divider />

        <div className="flex items-center gap-0.5">
          {TEXT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              title={`${color.label} text`}
              aria-label={`${color.label} text`}
              onClick={() => editor.chain().focus().setColor(color.value).run()}
              className="h-4 w-4 shrink-0 cursor-pointer rounded-full ring-1 ring-white/10"
              style={{ backgroundColor: color.value }}
            />
          ))}
        </div>

        <Divider />

        <div className="flex items-center gap-0.5">
          {BG_COLORS.map((bg) => (
            <button
              key={bg.label}
              type="button"
              title={bg.label}
              aria-label={bg.label}
              onClick={() =>
                bg.value
                  ? editor.chain().focus().setHighlight({ color: bg.value }).run()
                  : editor.chain().focus().unsetHighlight().run()
              }
              className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full ring-1 ring-white/10"
              style={{ backgroundColor: bg.value ?? "transparent" }}
            >
              {!bg.value && <span className="text-[8px] text-destructive">×</span>}
            </button>
          ))}
        </div>

        <Divider />

        <div className="flex items-center gap-0.5">
          {FONT_SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              title={`Text size ${s.label}`}
              onClick={() => editor.chain().focus().setFontSize(s.value).run()}
              className="cursor-pointer rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </BubbleMenu>
  );
}

function Divider() {
  return <div className="mx-0.5 h-4 w-px bg-white/[0.08]" />;
}

function MarkButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`cursor-pointer rounded-md p-1.5 ${
        active ? "bg-white/15 text-white" : "text-[#9aa0a6] hover:bg-white/[0.06] hover:text-[#e8eaed]"
      }`}
    >
      {children}
    </button>
  );
}
