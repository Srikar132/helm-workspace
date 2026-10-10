import { describe, expect, it } from "vitest";
import { clampScale, clampTransform, FIT, MAX_SCALE, pinchTransform, wheelScale, zoomAt } from "@/lib/pan-zoom";

const stage = { w: 800, h: 600 };
// An image fitted to the stage: full width, letterboxed vertically.
const content = { w: 800, h: 400 };

describe("clampScale", () => {
  it("stays within 1..MAX_SCALE", () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(3)).toBe(3);
  });

  it("treats garbage as fit", () => {
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe("clampTransform", () => {
  it("pins a fitted image to the centre", () => {
    expect(clampTransform({ scale: 1, x: 300, y: -200 }, content, stage)).toEqual(FIT);
  });

  it("lets a zoomed image move only until its edge meets the stage edge", () => {
    // 2x: content is 1600 wide in an 800 stage -> 400 of travel each way.
    // Vertically 800 tall in a 600 stage -> 100 each way.
    const t = clampTransform({ scale: 2, x: 9999, y: -9999 }, content, stage);
    expect(t).toEqual({ scale: 2, x: 400, y: -100 });
  });
});

describe("zoomAt", () => {
  it("keeps the content under the anchor where it was", () => {
    const anchor = { x: 100, y: 50 };
    const start = { scale: 1, x: 0, y: 0 };
    const next = zoomAt(start, 2, anchor, content, stage);
    // content point under the anchor: (anchor - t) / scale
    const before = { x: (anchor.x - start.x) / start.scale, y: (anchor.y - start.y) / start.scale };
    const after = { x: (anchor.x - next.x) / next.scale, y: (anchor.y - next.y) / next.scale };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("zooming back out to fit recentres the image", () => {
    const zoomed = zoomAt(FIT, 3, { x: 200, y: 100 }, content, stage);
    expect(zoomAt(zoomed, 1, { x: 200, y: 100 }, content, stage)).toEqual(FIT);
  });
});

describe("wheelScale", () => {
  it("zooms in on negative deltaY and out on positive", () => {
    expect(wheelScale(2, -100)).toBeGreaterThan(2);
    expect(wheelScale(2, 100)).toBeLessThan(2);
    expect(wheelScale(2, 0)).toBe(2);
  });
});

describe("pinchTransform", () => {
  it("doubles the scale when the fingers spread to twice the distance", () => {
    const t = pinchTransform(FIT, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 200, content, stage);
    expect(t.scale).toBe(2);
  });

  it("pans with the centroid", () => {
    const start = { scale: 2, x: 0, y: 0 };
    const t = pinchTransform(start, { x: 0, y: 0 }, 100, { x: 50, y: 20 }, 100, content, stage);
    expect(t).toEqual({ scale: 2, x: 50, y: 20 });
  });

  it("ignores a zero starting distance instead of dividing by it", () => {
    const t = pinchTransform(FIT, { x: 0, y: 0 }, 0, { x: 0, y: 0 }, 50, content, stage);
    expect(t).toEqual(FIT);
  });
});
