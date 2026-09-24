import { describe, expect, it } from "vitest";
import {
  MAX_RECIPIENTS_PER_NOTIFY,
  candidateRecipients,
  docPageHref,
  mentionDedupeKey,
  widgetHref,
} from "@/lib/notifications";
import { notificationKeys } from "@/lib/query-keys";

describe("candidateRecipients", () => {
  it("drops the actor, empties and duplicates", () => {
    expect(candidateRecipients(["a", "me", "", "b", "a"], "me")).toEqual(["a", "b"]);
  });

  it("caps fan-out per call", () => {
    const many = Array.from({ length: 50 }, (_, i) => `u${i}`);
    expect(candidateRecipients(many, null)).toHaveLength(MAX_RECIPIENTS_PER_NOTIFY);
  });

  it("keeps system/AI notifications (no actor) intact", () => {
    expect(candidateRecipients(["a"], null)).toEqual(["a"]);
  });
});

describe("mentionDedupeKey", () => {
  it("is stable per source and recipient — one mention notification per person per source", () => {
    expect(mentionDedupeKey("widget", "note-1", "u1")).toBe(mentionDedupeKey("widget", "note-1", "u1"));
    expect(mentionDedupeKey("widget", "note-1", "u1")).not.toBe(mentionDedupeKey("widget", "note-1", "u2"));
    expect(mentionDedupeKey("widget", "x", "u1")).not.toBe(mentionDedupeKey("doc_page", "x", "u1"));
  });
});

describe("hrefs", () => {
  it("builds encoded in-app links", () => {
    expect(widgetHref("my ws", "markdown-1")).toBe("/workspace/my%20ws?focus=markdown-1");
    expect(docPageHref("ws", "p1", "pg1")).toBe("/workspace/ws/docs/p1?page=pg1");
  });
});

describe("notificationKeys", () => {
  it("nests count and list under one root so a single invalidate covers both", () => {
    expect(notificationKeys.count().slice(0, 1)).toEqual([...notificationKeys.all]);
    expect(notificationKeys.list().slice(0, 1)).toEqual([...notificationKeys.all]);
  });
});
