import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_MAX_SIZE,
  ABSOLUTE_MIN_SIZE,
  WIDGET_SIZES,
  clampSize,
  defaultSize,
  isResizable,
  resizeLimits,
  settledSize,
  storedSize,
} from "@/lib/canvas/widget-sizing";
import { KNOWN_WIDGET_TYPES, buildNode, type WidgetNodeContext } from "@/components/canvas/widget-registry";

const CTX: WidgetNodeContext = {
  columns: [],
  canWrite: true,
  slug: "desk",
  initialProjectSummaries: {},
  initialAlbumPreviews: {},
  initialGmailStatus: { connected: false },
};

describe("sizing table", () => {
  it("covers every known widget type except draw, which has no size of its own", () => {
    const missing = [...KNOWN_WIDGET_TYPES].filter((t) => t !== "draw" && !(t in WIDGET_SIZES));
    expect(missing).toEqual([]);
  });

  it("gives every type a default inside its own limits", () => {
    for (const [type, spec] of Object.entries(WIDGET_SIZES)) {
      expect(spec.default.width, type).toBeGreaterThanOrEqual(ABSOLUTE_MIN_SIZE);
      expect(spec.default.height, type).toBeGreaterThanOrEqual(ABSOLUTE_MIN_SIZE);
      if (spec.resizable) {
        expect(spec.default.width, type).toBeGreaterThanOrEqual(spec.min.width);
        expect(spec.default.height, type).toBeGreaterThanOrEqual(spec.min.height);
        expect(spec.default.width, type).toBeLessThanOrEqual(spec.max.width);
        expect(spec.default.height, type).toBeLessThanOrEqual(spec.max.height);
        // A settled size is a size the user can also reach by hand.
        if (spec.settled) {
          expect(spec.settled.width, type).toBeGreaterThanOrEqual(spec.min.width);
          expect(spec.settled.height, type).toBeGreaterThanOrEqual(spec.min.height);
        }
      }
    }
  });

  it("falls back to a sensible default for a type it does not know", () => {
    expect(defaultSize("mystery")).toEqual({ width: 340, height: 320 });
    expect(isResizable("mystery")).toBe(true);
  });
});

describe("resizable vs fixed", () => {
  it("lists exactly the cards that show handles", () => {
    const resizable = Object.keys(WIDGET_SIZES).filter(isResizable).sort();
    expect(resizable).toEqual(["markdown", "media", "project-doc"]);
  });

  it("decides by type only — a draft bookmark or gallery is as fixed as a saved one", () => {
    expect(isResizable("bookmark")).toBe(false);
    expect(isResizable("gallery")).toBe(false);
    expect(isResizable("landmark")).toBe(false);
    expect(isResizable("code")).toBe(false);
    expect(isResizable("board")).toBe(false);
    expect(isResizable("mail-summary")).toBe(false);
  });
});

describe("clampSize", () => {
  it("holds a resizable type inside its min and max", () => {
    const { min, max } = resizeLimits("markdown");
    expect(clampSize("markdown", { width: 10, height: 10 })).toEqual(min);
    expect(clampSize("markdown", { width: 99999, height: 99999 })).toEqual(max);
    expect(clampSize("markdown", { width: 400.4, height: 300.6 })).toEqual({ width: 400, height: 301 });
  });

  it("lets a fixed-size type settle at any sane size, within the absolute bounds", () => {
    expect(clampSize("landmark", settledSize("landmark"))).toEqual(settledSize("landmark"));
    expect(clampSize("landmark", { width: 1, height: 1 })).toEqual({ width: ABSOLUTE_MIN_SIZE, height: ABSOLUTE_MIN_SIZE });
    expect(clampSize("landmark", { width: 1e6, height: 1e6 })).toEqual({ width: ABSOLUTE_MAX_SIZE, height: ABSOLUTE_MAX_SIZE });
  });
});

describe("stored size", () => {
  it("a stored height is the height, never a floor", () => {
    expect(storedSize("markdown", 340, 120)).toEqual({ width: 340, height: 120 });
  });

  it("rows saved before heights were always stored get the type's settled size", () => {
    expect(storedSize("markdown", 340, null)).toEqual({ width: 340, height: defaultSize("markdown").height });
    expect(storedSize("project-doc", 320, null)).toEqual({ width: 320, height: settledSize("project-doc").height });
  });
});

describe("buildNode", () => {
  const build = (type: string, height?: number) =>
    buildNode({ id: `${type}-1`, type, x: 0, y: 0, width: 340, height }, CTX);

  it.each(["markdown", "project-doc", "bookmark", "gallery", "code", "media", "board"])(
    "%s node is exactly its stored size, with no content-driven floor",
    (type) => {
      const node = build(type, 222);
      expect(node.height).toBe(222);
      expect(node.width).toBe(340);
      expect((node.data as Record<string, unknown>).minHeight).toBeUndefined();
    },
  );

  it("survives a resize → save → rebuild round trip unchanged", () => {
    const resized = clampSize("markdown", { width: 300, height: 130 });
    const rebuilt = buildNode({ id: "markdown-1", type: "markdown", x: 5, y: 6, ...resized }, CTX);
    expect({ width: rebuilt.width, height: rebuilt.height }).toEqual(resized);
  });

  it("gives an old null-height row a real height instead of leaving it to content", () => {
    expect(build("markdown").height).toBe(defaultSize("markdown").height);
  });
});
