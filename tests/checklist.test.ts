// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { createNoteExtensions } from "@/lib/tiptap/note-extensions";
import { moveTaskItem } from "@/lib/tiptap/task-item-move";
import { SLASH_ITEMS, filterSlashItems } from "@/lib/tiptap/slash-menu";

// The app's own extension list — a checklist test against a hand-rolled one
// proves nothing about what the note actually does.
let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function create(content: JSONContent | string = "") {
  editor = new Editor({ element: document.createElement("div"), extensions: createNoteExtensions(), content });
  return editor;
}

function task(text: string, checked = false, children?: JSONContent): JSONContent {
  return {
    type: "taskItem",
    attrs: { checked },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...(children ? [children] : [])],
  };
}

const list = (...items: JSONContent[]): JSONContent => ({ type: "taskList", content: items });
const doc = (...nodes: JSONContent[]): JSONContent => ({ type: "doc", content: nodes });

/** [text, checked] for each top-level item of the first task list. */
function items(e: Editor): [string, boolean][] {
  const content: JSONContent[] = e.getJSON().content ?? [];
  const taskList = content.find((n) => n.type === "taskList");
  return (taskList?.content ?? []).map((item: JSONContent): [string, boolean] => [
    item.content?.[0]?.content?.[0]?.text ?? "",
    Boolean(item.attrs?.checked),
  ]);
}

/** Walk `content[i]` down a path; JSONContent's own typing loses the node type
 *  after the first hop, hence the explicit annotation. */
function at(node: JSONContent | undefined, ...path: number[]): JSONContent | undefined {
  return path.reduce<JSONContent | undefined>((n, i) => n?.content?.[i], node);
}

/** Put the caret inside the item whose paragraph text is `text`. */
function caretIn(e: Editor, text: string) {
  let target = -1;
  e.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text && target < 0) target = pos + 1;
  });
  expect(target).toBeGreaterThan(-1);
  e.commands.setTextSelection(target);
}

describe("checklist persistence", () => {
  it("keeps checked state and order through a JSON round trip", () => {
    const e = create(doc(list(task("a", true), task("b"), task("c", true))));
    const reloaded = create(e.getJSON());
    expect(items(reloaded)).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
    ]);
  });

  it("serialises to GFM task syntax, nested items indented", () => {
    const e = create(doc(list(task("a", true), task("b", false, list(task("b1", true))))));
    const md = e.getMarkdown();
    expect(md).toContain("- [x] a");
    expect(md).toContain("- [ ] b");
    expect(md).toMatch(/\n\s{2,}- \[x\] b1/);
  });

  it("parses pasted GFM tasks and writes the same text back", () => {
    const source = "- [ ] todo\n- [x] done";
    const e = create();
    e.commands.setContent(source, { contentType: "markdown" });
    expect(items(e)).toEqual([
      ["todo", false],
      ["done", true],
    ]);
    expect(e.getMarkdown().trim()).toBe(source);
  });
});

describe("moveTaskItem (Alt+Up / Alt+Down)", () => {
  it("moves an item up, carrying its checked state", () => {
    const e = create(doc(list(task("a"), task("b"), task("c", true))));
    caretIn(e, "c");
    expect(moveTaskItem(e.state, e.view.dispatch, -1)).toBe(true);
    expect(items(e)).toEqual([
      ["a", false],
      ["c", true],
      ["b", false],
    ]);
  });

  it("moves an item down", () => {
    const e = create(doc(list(task("a", true), task("b"), task("c"))));
    caretIn(e, "a");
    moveTaskItem(e.state, e.view.dispatch, 1);
    expect(items(e)).toEqual([
      ["b", false],
      ["a", true],
      ["c", false],
    ]);
  });

  it("keeps the caret in the moved item so the move can repeat", () => {
    const e = create(doc(list(task("a"), task("b"), task("c"))));
    caretIn(e, "c");
    moveTaskItem(e.state, e.view.dispatch, -1);
    moveTaskItem(e.state, e.view.dispatch, -1);
    expect(items(e).map(([t]) => t)).toEqual(["c", "a", "b"]);
  });

  it("takes nested children along", () => {
    const e = create(doc(list(task("a"), task("b", false, list(task("b1", true))))));
    caretIn(e, "b");
    moveTaskItem(e.state, e.view.dispatch, -1);
    const first = at(e.getJSON(), 0, 0);
    expect(first?.content?.[1]?.type).toBe("taskList");
    expect(items(e).map(([t]) => t)).toEqual(["b", "a"]);
  });

  it("moves a nested item among its own siblings only", () => {
    const e = create(doc(list(task("a", false, list(task("a1"), task("a2"))))));
    caretIn(e, "a2");
    moveTaskItem(e.state, e.view.dispatch, -1);
    const nested = at(e.getJSON(), 0, 0, 1);
    expect(nested?.content?.map((i: JSONContent) => at(i, 0, 0)?.text)).toEqual(["a2", "a1"]);
  });

  it("is a no-op that still claims the key at either end", () => {
    const e = create(doc(list(task("a"), task("b"))));
    caretIn(e, "a");
    const before = JSON.stringify(e.getJSON());
    expect(moveTaskItem(e.state, e.view.dispatch, -1)).toBe(true);
    caretIn(e, "b");
    expect(moveTaskItem(e.state, e.view.dispatch, 1)).toBe(true);
    expect(JSON.stringify(e.getJSON())).toBe(before);
  });

  it("does nothing outside a checklist", () => {
    const e = create("<p>plain</p>");
    e.commands.setTextSelection(2);
    expect(moveTaskItem(e.state, e.view.dispatch, -1)).toBe(false);
  });
});

describe("slash menu", () => {
  it("filters by title and by keyword", () => {
    expect(filterSlashItems("").length).toBe(SLASH_ITEMS.length);
    expect(filterSlashItems("check").map((i) => i.id)).toEqual(["taskList"]);
    expect(filterSlashItems("todo").map((i) => i.id)).toEqual(["taskList"]);
    expect(filterSlashItems("zzz")).toEqual([]);
  });

  it("Checklist replaces the typed slash with a task list", () => {
    const e = create("<p>/</p>");
    const item = SLASH_ITEMS.find((i) => i.id === "taskList")!;
    item.run(e, { from: 1, to: 2 });
    const types: string[] = [];
    e.state.doc.descendants((n) => {
      types.push(n.type.name);
    });
    expect(types).toContain("taskList");
    expect(e.getText()).not.toContain("/");
  });

  it("Heading 1 turns the block into a heading", () => {
    const e = create("<p>/</p>");
    SLASH_ITEMS.find((i) => i.id === "heading1")!.run(e, { from: 1, to: 2 });
    expect(e.getJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
  });
});
