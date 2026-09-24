// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import {
  MAX_COMMENT_JSON_BYTES,
  MAX_COMMENT_TEXT,
  isPinDrag,
  replyRecipients,
  validateCommentBody,
} from "@/lib/comments";
import { createCommentExtensions, isSuggestionActive } from "@/lib/tiptap/comment-extensions";
import { extractMentionIds } from "@/lib/mentions";
import { commentMentionDedupeKey, commentReplyDedupeKey, threadHref } from "@/lib/notifications";
import { timeAgo } from "@/lib/relative-time";

const para = (...inline: unknown[]) => ({ type: "paragraph", content: inline });
const doc = (...blocks: unknown[]) => ({ type: "doc", content: blocks });
const text = (t: string) => ({ type: "text", text: t });
const mention = (id: string, label = id) => ({ type: "mention", attrs: { id, label } });

describe("validateCommentBody", () => {
  it("accepts a normal comment and one that is only a mention", () => {
    expect(validateCommentBody(doc(para(text("is this fixed?")))).ok).toBe(true);
    expect(validateCommentBody(doc(para(mention("u1", "Asha")))).ok).toBe(true);
  });

  it("rejects empty, whitespace-only and non-doc bodies", () => {
    expect(validateCommentBody(doc(para())).ok).toBe(false);
    expect(validateCommentBody(doc(para(text("   ")))).ok).toBe(false);
    expect(validateCommentBody({ type: "paragraph" }).ok).toBe(false);
    expect(validateCommentBody(null).ok).toBe(false);
    expect(validateCommentBody([doc()]).ok).toBe(false);
  });

  it("caps text length and raw JSON size", () => {
    expect(validateCommentBody(doc(para(text("x".repeat(MAX_COMMENT_TEXT))))).ok).toBe(true);
    expect(validateCommentBody(doc(para(text("x".repeat(MAX_COMMENT_TEXT + 1))))).ok).toBe(false);
    const bloated = doc(para(text("hi"), { type: "text", text: "", junk: "y".repeat(MAX_COMMENT_JSON_BYTES) }));
    expect(validateCommentBody(bloated).ok).toBe(false);
  });
});

describe("replyRecipients", () => {
  it("notifies the thread author and prior commenters once, never the replier", () => {
    expect(
      replyRecipients({ threadAuthorId: "a", priorCommentAuthorIds: ["a", "b", "me", "b", null], actorId: "me", mentionedIds: [] }),
    ).toEqual(["a", "b"]);
  });

  it("leaves out anyone the same reply mentions — the mention wins", () => {
    expect(
      replyRecipients({ threadAuthorId: "a", priorCommentAuthorIds: ["b"], actorId: "me", mentionedIds: ["a"] }),
    ).toEqual(["b"]);
  });

  it("handles a deleted thread author", () => {
    expect(replyRecipients({ threadAuthorId: null, priorCommentAuthorIds: [], actorId: "me", mentionedIds: [] })).toEqual([]);
  });
});

describe("comment notification keys and links", () => {
  it("dedupes per comment, so each reply notifies again but a retry doesn't", () => {
    expect(commentReplyDedupeKey("c1", "u1")).toBe(commentReplyDedupeKey("c1", "u1"));
    expect(commentReplyDedupeKey("c1", "u1")).not.toBe(commentReplyDedupeKey("c2", "u1"));
    expect(commentMentionDedupeKey("c1", "u1")).not.toBe(commentReplyDedupeKey("c1", "u1"));
  });

  it("links to the pin on the workspace canvas", () => {
    expect(threadHref("my ws", "t-1")).toBe("/workspace/my%20ws?thread=t-1");
  });
});

describe("isPinDrag", () => {
  it("treats a small wobble as a click", () => {
    expect(isPinDrag(2, 2)).toBe(false);
    expect(isPinDrag(3, 3)).toBe(true);
    expect(isPinDrag(0, -10)).toBe(true);
  });
});

describe("timeAgo", () => {
  it("formats past times and clamps tiny future skew to now", () => {
    const now = Date.parse("2026-09-24T12:00:00Z");
    expect(timeAgo("2026-09-24T11:58:00Z", now)).toMatch(/2/);
    expect(timeAgo("2026-09-24T12:00:00.500Z", now)).toBe(timeAgo("2026-09-24T12:00:00Z", now));
  });
});

describe("comment editor schema", () => {
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  const create = (content: unknown) =>
    (editor = new Editor({
      element: document.createElement("div"),
      extensions: createCommentExtensions(),
      content: content as Record<string, unknown>,
    }));

  it("keeps paragraphs, marks and mentions", () => {
    const e = create(doc(para({ type: "text", text: "ship it", marks: [{ type: "bold" }] }, mention("u9", "Ravi"))));
    expect(extractMentionIds(e.getJSON())).toEqual(["u9"]);
    expect(JSON.stringify(e.getJSON())).toContain('"bold"');
  });

  it("has no block types a comment doesn't allow", () => {
    // Content outside the schema is dropped, not smuggled through.
    const e = create(doc({ type: "heading", attrs: { level: 1 }, content: [text("Big")] }));
    expect(JSON.stringify(e.getJSON())).not.toContain('"heading"');
    for (const name of ["heading", "bulletList", "orderedList", "codeBlock", "blockquote", "table"]) {
      expect(e.schema.nodes[name]).toBeUndefined();
    }
  });

  it("reports no active suggestion on a fresh editor", () => {
    const e = create(doc(para(text("hello"))));
    expect(isSuggestionActive(e.state)).toBe(false);
  });
});
