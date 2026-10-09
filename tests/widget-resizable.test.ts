import { describe, expect, it } from "vitest";
import { isWidgetResizable, NON_RESIZABLE_WIDGET_TYPES } from "@/components/canvas/widget-registry";

/**
 * bookmark and gallery cards hug their own content, so a saved one shouldn't be
 * draggable to an arbitrary size. But both spend their first moments as a form,
 * and a form you can't resize is a form you can't fill in — so the type rule
 * holds once saved and lifts while the widget is still a draft.
 */
describe("isWidgetResizable", () => {
  it("allows resizing for types that aren't content-hugging", () => {
    for (const type of ["markdown", "media", "project-doc"]) {
      expect(isWidgetResizable(type, {})).toBe(true);
    }
  });

  it("keeps a saved bookmark card fixed to its content", () => {
    expect(isWidgetResizable("bookmark", { url: "https://example.com", title: "Example" })).toBe(false);
  });

  it("lets an empty bookmark form be resized", () => {
    expect(isWidgetResizable("bookmark", undefined)).toBe(true);
    expect(isWidgetResizable("bookmark", {})).toBe(true);
  });

  it("treats a mid-fetch bookmark as saved, since that state is a spinner not a form", () => {
    expect(isWidgetResizable("bookmark", { pendingUrl: "https://example.com" })).toBe(false);
  });

  it("lets a gallery form be resized until an album is chosen", () => {
    expect(isWidgetResizable("gallery", {})).toBe(true);
    expect(isWidgetResizable("gallery", { albumId: "album_1" })).toBe(false);
  });

  it("never lets board or mail-summary resize, draft or not", () => {
    // Neither has a creation form — they're pinned, always-populated cards.
    for (const type of ["board", "mail-summary"]) {
      expect(isWidgetResizable(type, {})).toBe(false);
      expect(isWidgetResizable(type, undefined)).toBe(false);
    }
  });

  it("covers every type listed as non-resizable", () => {
    // If a type is added to that set later, it needs a draft rule here or it
    // silently becomes un-resizable even while showing a form.
    expect([...NON_RESIZABLE_WIDGET_TYPES].sort()).toEqual([
      "board",
      "bookmark",
      "code",
      "draw",
      "gallery",
      "landmark",
      "mail-summary",
    ]);
  });

  it("never resizes a code card, which has no form to grow into", () => {
    // Unlike bookmark and gallery, a code widget never shows a creation form on
    // the canvas — the editor is a separate window — so there's no draft state
    // that needs the type rule lifted.
    expect(isWidgetResizable("code", {})).toBe(false);
    expect(isWidgetResizable("code", { code: "print(1)" })).toBe(false);
    expect(isWidgetResizable("code", undefined)).toBe(false);
  });
});
