import type { Extensions } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Mention, type MentionOptions } from "@tiptap/extension-mention";

/**
 * The schema behind canvas comments — deliberately small: paragraphs, inline
 * marks, links and mentions. No headings, lists, code blocks or tables; a
 * comment is a sentence or two, and a smaller schema is less to render and
 * less to validate. Mentions use the same node as notes, so extractMentionIds
 * and redactMentions work unchanged.
 */

/** True while a suggestion popup (the `@` picker) is open. Mention's plugin
 *  key is private, so this reads suggestion-shaped plugin state instead. The
 *  composer's Enter-to-post checks it: editorProps key handlers run BEFORE
 *  plugin handlers, so without this Enter would post instead of picking. */
export function isSuggestionActive(state: EditorState): boolean {
  return state.plugins.some((plugin) => {
    const pluginState = plugin.getState(state) as { active?: unknown; query?: unknown } | undefined;
    return (
      !!pluginState && typeof pluginState === "object" && "query" in pluginState && pluginState.active === true
    );
  });
}

export function createCommentExtensions({
  placeholder = "Add a comment…",
  mentionSuggestion,
}: {
  placeholder?: string;
  mentionSuggestion?: MentionOptions["suggestion"];
} = {}): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
    }),
    Placeholder.configure({ placeholder }),
    Mention.configure({
      HTMLAttributes: { class: "mention" },
      suggestion: mentionSuggestion ?? { items: () => [] },
    }),
  ];
}
