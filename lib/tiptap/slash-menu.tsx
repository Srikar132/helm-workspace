"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import { Heading1, Heading2, List, ListChecks, ListOrdered, Quote, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The `/` block menu — how block-level formatting (headings, lists, checklist,
 * quote) is reached now that text formatting follows the selection instead of
 * living in a bar above the card. Same shape as the `@` picker
 * (mention-suggestion.tsx): a ReactRenderer mounted through `props.mount`,
 * positioned by floating-ui with a fixed strategy so the note's transformed,
 * overflow-hidden card can't clip or offset it.
 */

export interface SlashItem {
  id: string;
  title: string;
  hint: string;
  /** Extra words the filter matches, e.g. "todo" finds Checklist. */
  keywords: string[];
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "heading1",
    title: "Heading 1",
    hint: "Large section heading",
    keywords: ["h1", "title", "heading"],
    icon: Heading1,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "heading2",
    title: "Heading 2",
    hint: "Medium section heading",
    keywords: ["h2", "subtitle", "heading"],
    icon: Heading2,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "bulletList",
    title: "Bullet list",
    hint: "Simple bulleted list",
    keywords: ["ul", "unordered", "list"],
    icon: List,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "orderedList",
    title: "Numbered list",
    hint: "List with numbering",
    keywords: ["ol", "ordered", "list"],
    icon: ListOrdered,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "taskList",
    title: "Checklist",
    hint: "Track tasks with checkboxes",
    keywords: ["todo", "task", "checkbox", "check", "to-do"],
    icon: ListChecks,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "blockquote",
    title: "Quote",
    hint: "Capture a quote",
    keywords: ["blockquote", "cite"],
    icon: Quote,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
];

export function filterSlashItems(query: string, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(
    (item) => item.title.toLowerCase().includes(needle) || item.keywords.some((k) => k.includes(needle)),
  );
}

type SlashSuggestion = Omit<SuggestionOptions<SlashItem, SlashItem>, "editor">;

function createSlashSuggestion(): SlashSuggestion {
  return {
    char: "/",
    pluginKey: new PluginKey("slashMenu"),
    // Never in a heading or code, where a leading "/" is just text.
    allow: ({ state, range }) => {
      const parent = state.doc.resolve(range.from).parent;
      return parent.type.name === "paragraph";
    },
    items: ({ query }) => filterSlashItems(query),
    command: ({ editor, range, props }) => props.run(editor, range),
    floatingUi: { strategy: "fixed" },
    render: () => {
      let component: ReactRenderer<SlashListHandle, SlashListProps> | null = null;
      let unmount: (() => void) | null = null;

      return {
        onStart(props) {
          component = new ReactRenderer(SlashList, { props, editor: props.editor });
          component.element.style.zIndex = "55";
          unmount = props.mount(component.element);
        },
        onUpdate(props) {
          component?.updateProps(props);
        },
        onKeyDown(props) {
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit() {
          unmount?.();
          unmount = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}

/** Registered in the shared extension list. Suggestion only reacts to typing,
 *  so a read-only note or the public share page never opens it. */
export const SlashMenu = Extension.create({
  name: "slashMenu",
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...createSlashSuggestion() })];
  },
});

type SlashListProps = SuggestionProps<SlashItem, SlashItem>;
type SlashListHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

const SlashList = forwardRef<SlashListHandle, SlashListProps>(function SlashList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);
  const [lastItems, setLastItems] = useState(items);
  if (lastItems !== items) {
    setLastItems(items);
    setSelected(0);
  }

  const pick = (index: number) => {
    const item = items[index];
    if (item) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelected((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        pick(selected);
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      role="listbox"
      aria-label="Insert a block"
      className="z-50 w-60 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">No matching blocks</div>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === selected}
            onMouseEnter={() => setSelected(index)}
            onClick={() => pick(index)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
              index === selected && "bg-accent text-accent-foreground",
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
              <item.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm">{item.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
            </span>
          </button>
        ))
      )}
    </div>
  );
});
