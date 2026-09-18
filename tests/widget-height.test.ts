import { describe, expect, it } from "vitest";
import { buildNode, AUTO_HEIGHT_MIN, type WidgetNodeContext } from "@/components/canvas/widget-registry";
import type { WidgetLayoutItem } from "@/lib/db";
import type { WidgetNodeData } from "@/components/canvas/widget-node";

const CTX: WidgetNodeContext = {
  columns: [],
  canWrite: true,
  slug: "desk",
  initialProjectSummaries: {},
  initialAlbumPreviews: {},
  initialGmailStatus: { connected: false },
};

function build(item: Partial<WidgetLayoutItem> & { type: string }) {
  const node = buildNode({ id: `${item.type}-1`, x: 0, y: 0, width: 340, ...item }, CTX);
  return { height: node.height, minHeight: (node.data as unknown as WidgetNodeData).minHeight };
}

/**
 * A stored height is a FLOOR for widgets whose content varies, not a fixed size.
 * Pinning it meant whatever a card was last dragged to became a hard ceiling — so
 * opening a five-field edit form inside a 138px-tall project card crushed it, and
 * a note could never outgrow the box it was created in.
 */
describe("content-height widget types", () => {
  it.each(["markdown", "project-doc", "bookmark", "gallery"])(
    "%s leaves height unset so the card can grow with its content",
    (type) => {
      expect(build({ type, height: 138 }).height).toBeUndefined();
    },
  );

  it.each(["markdown", "project-doc", "bookmark", "gallery"])(
    "%s keeps the user's dragged height as a floor",
    (type) => {
      expect(build({ type, height: 420 }).minHeight).toBe(420);
    },
  );

  it("falls back to the type's own floor when nothing was ever stored", () => {
    expect(build({ type: "markdown" }).minHeight).toBe(AUTO_HEIGHT_MIN.markdown);
    expect(build({ type: "project-doc" }).minHeight).toBe(AUTO_HEIGHT_MIN["project-doc"]);
  });

  it("lets a small stored height stay small — a compact card is allowed", () => {
    // The card shouldn't be forced tall; it should be free to GROW when its
    // content needs it, which is what an unset height achieves.
    const { height, minHeight } = build({ type: "project-doc", height: 138 });
    expect(height).toBeUndefined();
    expect(minHeight).toBe(138);
  });
});

describe("fixed-viewport widget types", () => {
  // These scroll internally; a card that grew to the length of a mail list or a
  // board column would be unusable.
  it.each(["board", "mail-summary", "media"])("%s keeps its stored height fixed", (type) => {
    expect(build({ type, height: 420 }).height).toBe(420);
  });

  it("still applies the type floor when no height is stored", () => {
    expect(build({ type: "board" }).height).toBeUndefined();
  });
});
