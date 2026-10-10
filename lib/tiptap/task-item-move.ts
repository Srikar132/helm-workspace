import { Extension } from "@tiptap/core";
import { Selection, type EditorState, type Transaction } from "@tiptap/pm/state";

/**
 * Move the checklist item holding the caret one place up (-1) or down (+1)
 * among its siblings, taking its children and `checked` state with it.
 *
 * Returns true whenever the caret is in a task item — including at either end,
 * where it moves nothing but still swallows the key so Alt+Arrow doesn't fall
 * through to the browser. Returns false outside a checklist.
 */
export function moveTaskItem(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: -1 | 1,
): boolean {
  const { $from } = state.selection;

  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.name !== "taskItem") depth--;
  if (depth === 0) return false;

  const list = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= list.childCount) return true;

  if (dispatch) {
    const item = list.child(index);
    const neighbour = list.child(targetIndex);
    const itemStart = $from.before(depth);
    const offsetInItem = $from.pos - itemStart;

    const from = direction < 0 ? itemStart - neighbour.nodeSize : itemStart;
    const to = direction < 0 ? itemStart + item.nodeSize : itemStart + item.nodeSize + neighbour.nodeSize;
    const swapped = direction < 0 ? [item, neighbour] : [neighbour, item];

    const tr = state.tr.replaceWith(from, to, swapped);
    const newItemStart = direction < 0 ? from : from + neighbour.nodeSize;
    tr.setSelection(Selection.near(tr.doc.resolve(newItemStart + offsetInItem)));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Alt+ArrowUp / Alt+ArrowDown reorder checklist items. */
export const TaskItemMove = Extension.create({
  name: "taskItemMove",
  addKeyboardShortcuts() {
    return {
      "Alt-ArrowUp": ({ editor }) => moveTaskItem(editor.state, editor.view.dispatch, -1),
      "Alt-ArrowDown": ({ editor }) => moveTaskItem(editor.state, editor.view.dispatch, 1),
    };
  },
});
