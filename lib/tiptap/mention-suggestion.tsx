"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { ReactRenderer } from "@tiptap/react";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import type { MentionableMember } from "@/lib/actions/members";
import { cn } from "@/lib/utils";

/**
 * The `@` picker. Follows Tiptap's documented default: a ReactRenderer mounted
 * through `props.mount`, which hands positioning to floating-ui and cleans up
 * on exit. `strategy: "fixed"` because a note lives inside xyflow's transformed,
 * overflow-hidden widget — absolute positioning would be clipped or offset.
 *
 * Members come from a getter, not a value: the extension list is built once
 * per editor, while the member query resolves (and refreshes) later.
 */

const MAX_ITEMS = 8;

type MentionSuggestion = Omit<SuggestionOptions<MentionableMember, MentionNodeAttrs>, "editor">;

export function filterMentionMembers(members: MentionableMember[], query: string): MentionableMember[] {
  const needle = query.trim().toLowerCase();
  return members.filter((m) => m.name.toLowerCase().includes(needle)).slice(0, MAX_ITEMS);
}

export function createMentionSuggestion(getMembers: () => MentionableMember[]): MentionSuggestion {
  return {
    items: ({ query }) => filterMentionMembers(getMembers(), query),
    floatingUi: { strategy: "fixed" },
    render: () => {
      let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
      let unmount: (() => void) | null = null;

      return {
        onStart(props) {
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
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

type MentionListProps = SuggestionProps<MentionableMember, MentionNodeAttrs>;
type MentionListHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);
  // Reset the highlight when the result set changes — adjusting state during
  // render, not in an effect, per React's guidance for derived resets.
  const [lastItems, setLastItems] = useState(items);
  if (lastItems !== items) {
    setLastItems(items);
    setSelected(0);
  }

  const pick = (index: number) => {
    const item = items[index];
    if (item) command({ id: item.id, label: item.name });
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
      aria-label="Mention a teammate"
      // z above canvas chrome; the popup is appended to <body>.
      className="z-50 min-w-48 max-w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">No matching members</div>
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
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
              index === selected && "bg-accent text-accent-foreground",
            )}
          >
            {item.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote OAuth avatar; no-referrer because Google avatars 429 hotlinked requests
              <img src={item.image} alt="" referrerPolicy="no-referrer" className="size-5 shrink-0 rounded-full" />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                {item.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="truncate">{item.name}</span>
          </button>
        ))
      )}
    </div>
  );
});
