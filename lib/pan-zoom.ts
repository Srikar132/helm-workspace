/**
 * Pure maths for the lightbox's pan/zoom. All coordinates are relative to the
 * stage CENTRE and the transform origin is the content's centre, so a content
 * point `p` lands on screen at `t + scale * p`. Keeping that one identity
 * makes every operation below a one-liner and keeps the component free of
 * geometry.
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;
/** Scale a double-click / double-tap jumps to from the fit view. */
export const DOUBLE_TAP_SCALE = 2.5;
/** Multiplier for one press of a zoom button or +/- key. */
export const ZOOM_STEP = 1.5;

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export const FIT: Transform = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Keep the image from being flung off the stage. The scaled content may move
 * only as far as its edge reaching the stage edge; content smaller than the
 * stage on an axis stays centred on that axis.
 */
export function clampTransform(t: Transform, content: Size, stage: Size): Transform {
  const scale = clampScale(t.scale);
  const maxX = Math.max(0, (content.w * scale - stage.w) / 2);
  const maxY = Math.max(0, (content.h * scale - stage.h) / 2);
  // `+ 0` turns a -0 (from clamping to -0) into 0, so a fitted image compares
  // equal to FIT.
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, t.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, t.y)) + 0,
  };
}

/** Zoom to `nextScale` keeping the content under `anchor` where it is. */
export function zoomAt(t: Transform, nextScale: number, anchor: Point, content: Size, stage: Size): Transform {
  const scale = clampScale(nextScale);
  const ratio = scale / t.scale;
  return clampTransform(
    { scale, x: anchor.x - (anchor.x - t.x) * ratio, y: anchor.y - (anchor.y - t.y) * ratio },
    content,
    stage,
  );
}

/** Scale factor for a wheel event; `deltaY` < 0 zooms in. Exponential so a
 *  trackpad's many tiny deltas and a mouse wheel's few big ones feel alike. */
export function wheelScale(current: number, deltaY: number): number {
  return current * Math.exp(-deltaY * 0.0015);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Transform for a two-finger gesture, derived from where it STARTED rather
 * than accumulated per move event — no drift, and the content point that was
 * under the fingers' centroid at the start follows the centroid.
 */
export function pinchTransform(
  start: Transform,
  startCentroid: Point,
  startDistance: number,
  centroid: Point,
  currentDistance: number,
  content: Size,
  stage: Size,
): Transform {
  if (startDistance <= 0) return clampTransform(start, content, stage);
  const scale = clampScale(start.scale * (currentDistance / startDistance));
  const ratio = scale / start.scale;
  return clampTransform(
    {
      scale,
      x: centroid.x - (startCentroid.x - start.x) * ratio,
      y: centroid.y - (startCentroid.y - start.y) * ratio,
    },
    content,
    stage,
  );
}
