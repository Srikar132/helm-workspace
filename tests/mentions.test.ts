// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createNoteExtensions } from "@/lib/tiptap/note-extensions";
import { REDACTED_MENTION_TEXT, diffMentions, docSnippet, extractMentionIds, redactMentions } from "@/lib/mentions";
import { filterMentionMembers } from "@/lib/tiptap/mention-suggestion";

const mention = (id: string, label = id) => ({ type: "mention", attrs: { id, label } });
const doc = (...inline: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content: inline }] });

describe("extractMentionIds", () => {
  it("finds mentions at any depth, deduped, in document order", () => {
    const nested = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi " }, mention("u2")] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [mention("u1"), mention("u2")] }] }] },
      ],
    };
    expect(extractMentionIds(nested)).toEqual(["u2", "u1"]);
  });

  it("tolerates junk — it reads client-written JSONB", () => {
    expect(extractMentionIds(null)).toEqual([]);
    expect(extractMentionIds("text")).toEqual([]);
    expect(extractMentionIds({ type: "mention", attrs: { id: 42 } })).toEqual([]);
    expect(extractMentionIds({ type: "mention", attrs: { id: "" } })).toEqual([]);
    expect(extractMentionIds({ content: "not-an-array" })).toEqual([]);
  });

  it("ignores plain @name text", () => {
    expect(extractMentionIds(doc({ type: "text", text: "@alice please check" }))).toEqual([]);
  });
});

describe("diffMentions", () => {
  it("returns only newly added ids", () => {
    expect(diffMentions(doc(mention("a")), doc(mention("a"), mention("b")))).toEqual(["b"]);
  });

  it("is empty on an unchanged re-save (what every autosave looks like)", () => {
    const d = doc(mention("a"), mention("b"));
    expect(diffMentions(d, d)).toEqual([]);
  });

  it("treats a missing previous doc as empty", () => {
    expect(diffMentions(undefined, doc(mention("a")))).toEqual(["a"]);
  });
});

describe("docSnippet", () => {
  it("flattens text and mention labels and truncates", () => {
    expect(docSnippet(doc({ type: "text", text: "ping " }, mention("u1", "Asha")))).toBe("ping @Asha");
    expect(docSnippet(doc({ type: "text", text: "x".repeat(200) }), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("redactMentions", () => {
  it("strips every mention's id and name for the public share page", () => {
    const input = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "ask " }, mention("user-9", "Asha")] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [mention("user-7", "Ravi")] }] }] },
      ],
    };
    const out = redactMentions(input);
    expect(extractMentionIds(out)).toEqual([]);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/user-9|user-7|Asha|Ravi/);
    expect(serialized).toContain(REDACTED_MENTION_TEXT);
    // Pure: the stored doc is untouched.
    expect(extractMentionIds(input)).toEqual(["user-9", "user-7"]);
  });

  it("passes null and non-objects through", () => {
    expect(redactMentions(null)).toBeNull();
    expect(redactMentions("x")).toBe("x");
  });
});

describe("filterMentionMembers", () => {
  const members = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, name: `Member ${i}`, image: null }));

  it("matches case-insensitively and caps the list", () => {
    expect(filterMentionMembers(members, "MEMBER 1").map((m) => m.id)).toEqual(["u1", "u10", "u11"]);
    expect(filterMentionMembers(members, "")).toHaveLength(8);
  });
});

describe("mention node in the note schema", () => {
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  const create = (content: unknown) =>
    (editor = new Editor({
      element: document.createElement("div"),
      extensions: createNoteExtensions(),
      content: content as Record<string, unknown>,
    }));

  it("survives a JSON round trip with its id", () => {
    const e = create(doc({ type: "text", text: "hey " }, mention("user-1", "Asha")));
    expect(extractMentionIds(e.getJSON())).toEqual(["user-1"]);
  });

  it("survives a markdown round trip with its id", () => {
    const e = create(doc({ type: "text", text: "hey " }, mention("user-1", "Asha")));
    const md = e.getMarkdown();
    e.commands.setContent(md, { contentType: "markdown" });
    const [node] = findMentions(e);
    expect(node).toMatchObject({ id: "user-1", label: "Asha" });
  });

  it("keeps the id even when the label contains a quote", () => {
    // The built-in serializer doesn't escape `"` in attrs — pin what happens
    // so a change is noticed. The id (what notifications use) must survive.
    const e = create(doc(mention("user-2", 'Sam "the" Man')));
    e.commands.setContent(e.getMarkdown(), { contentType: "markdown" });
    expect(findMentions(e).map((m) => m.id)).toContain("user-2");
  });
});

function findMentions(e: Editor): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  e.state.doc.descendants((node) => {
    if (node.type.name === "mention") out.push({ id: node.attrs.id as string, label: node.attrs.label as string });
  });
  return out;
}
