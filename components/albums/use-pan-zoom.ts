"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampTransform,
  distance,
  DOUBLE_TAP_SCALE,
  FIT,
  midpoint,
  pinchTransform,
  wheelScale,
  zoomAt,
  ZOOM_STEP,
  type Point,
  type Size,
  type Transform,
} from "@/lib/pan-zoom";

/** Movement (px) beyond which a press is a drag, not a tap. */
const TAP_SLOP = 4;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 30;
const KEY_PAN_STEP = 60;

interface Measure {
  stage: Size;
  content: Size;
  /** Stage centre in client coordinates — the transform's origin. */
  center: Point;
}

interface PanStart {
  pointer: Point;
  transform: Transform;
}

interface PinchStart {
  transform: Transform;
  centroid: Point;
  distance: number;
}

interface Gesture {
  pointers: Map<number, Point>;
  pan: PanStart | null;
  pinch: PinchStart | null;
  /** The press that began this gesture, for tap / drag classification. */
  down: { point: Point; target: EventTarget | null; atFit: boolean } | null;
  moved: boolean;
  lastTap: { time: number; point: Point } | null;
}

/**
 * Pan / zoom / pinch for one image in a stage. Geometry lives in
 * `lib/pan-zoom.ts`; this only turns pointer, wheel and key events into calls
 * to it. The transform is state (it drives the render) AND mirrored in a ref
 * so a burst of pointer-move events always builds on the latest value rather
 * than on whatever the last render closed over.
 *
 * Mount it under a `key` that changes with the image — that resets the zoom
 * for free instead of syncing it from an effect.
 */
export function usePanZoom({ onBackdropTap }: { onBackdropTap: () => void }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLImageElement>(null);
  const transformRef = useRef<Transform>(FIT);
  const [transform, setTransform] = useState<Transform>(FIT);
  // Buttons and double-tap glide; a finger or wheel must track 1:1.
  const [animated, setAnimated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture>({
    pointers: new Map(),
    pan: null,
    pinch: null,
    down: null,
    moved: false,
    lastTap: null,
  });

  const apply = useCallback((next: Transform, animate: boolean) => {
    transformRef.current = next;
    setTransform(next);
    setAnimated(animate);
  }, []);

  const measure = useCallback((): Measure | null => {
    const surface = surfaceRef.current;
    const content = contentRef.current;
    if (!surface || !content) return null;
    const rect = surface.getBoundingClientRect();
    return {
      stage: { w: rect.width, h: rect.height },
      // offsetWidth/Height are the LAYOUT size, unaffected by the transform.
      content: { w: content.offsetWidth, h: content.offsetHeight },
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    };
  }, []);

  const zoomTo = useCallback(
    (nextScale: number, anchorClient: Point | null, animate: boolean) => {
      const m = measure();
      if (!m) return;
      const anchor = anchorClient ? { x: anchorClient.x - m.center.x, y: anchorClient.y - m.center.y } : { x: 0, y: 0 };
      apply(zoomAt(transformRef.current, nextScale, anchor, m.content, m.stage), animate);
    },
    [apply, measure],
  );

  const zoomIn = useCallback(() => zoomTo(transformRef.current.scale * ZOOM_STEP, null, true), [zoomTo]);
  const zoomOut = useCallback(() => zoomTo(transformRef.current.scale / ZOOM_STEP, null, true), [zoomTo]);
  const reset = useCallback(() => apply(FIT, true), [apply]);

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const m = measure();
      if (!m) return;
      const t = transformRef.current;
      apply(clampTransform({ ...t, x: t.x + dx, y: t.y + dy }, m.content, m.stage), false);
    },
    [apply, measure],
  );

  // Wheel needs a NON-passive listener: React's onWheel is passive, so it
  // could not stop ctrl+wheel (a trackpad pinch) from zooming the whole page.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      zoomTo(wheelScale(transformRef.current.scale, e.deltaY), { x: e.clientX, y: e.clientY }, false);
    }
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // +/-/0 and arrows (arrows pan only while zoomed; at fit the lightbox uses
  // them to change photo).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-" || e.key === "_") zoomOut();
      else if (e.key === "0") reset();
      else if (transformRef.current.scale > 1 && e.key.startsWith("Arrow")) {
        const step = KEY_PAN_STEP;
        if (e.key === "ArrowLeft") panBy(step, 0);
        if (e.key === "ArrowRight") panBy(-step, 0);
        if (e.key === "ArrowUp") panBy(0, step);
        if (e.key === "ArrowDown") panBy(0, -step);
      } else return;
      e.preventDefault();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [zoomIn, zoomOut, reset, panBy]);

  function startPinchOrPan() {
    const g = gesture.current;
    const points = [...g.pointers.values()];
    const t = transformRef.current;
    const m = measure();
    if (points.length >= 2 && m) {
      const [a, b] = points;
      const mid = midpoint(a, b);
      g.pinch = {
        transform: t,
        centroid: { x: mid.x - m.center.x, y: mid.y - m.center.y },
        distance: distance(a, b),
      };
      g.pan = null;
    } else if (points.length === 1) {
      g.pan = { pointer: points[0], transform: t };
      g.pinch = null;
    } else {
      g.pan = null;
      g.pinch = null;
    }
  }

  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const g = gesture.current;
      e.currentTarget.setPointerCapture(e.pointerId);
      g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.pointers.size === 1) {
        g.moved = false;
        g.down = { point: { x: e.clientX, y: e.clientY }, target: e.target, atFit: transformRef.current.scale === 1 };
      } else {
        // A second finger makes this a pinch, never a tap.
        g.moved = true;
      }
      startPinchOrPan();
    },

    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g.pointers.has(e.pointerId)) return;
      g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const m = measure();
      if (!m) return;

      if (g.pinch && g.pointers.size >= 2) {
        const [a, b] = [...g.pointers.values()];
        const mid = midpoint(a, b);
        apply(
          pinchTransform(
            g.pinch.transform,
            g.pinch.centroid,
            g.pinch.distance,
            { x: mid.x - m.center.x, y: mid.y - m.center.y },
            distance(a, b),
            m.content,
            m.stage,
          ),
          false,
        );
        return;
      }

      if (g.pan && g.down) {
        const dx = e.clientX - g.pan.pointer.x;
        const dy = e.clientY - g.pan.pointer.y;
        if (!g.moved && Math.hypot(e.clientX - g.down.point.x, e.clientY - g.down.point.y) > TAP_SLOP) {
          g.moved = true;
          if (transformRef.current.scale > 1) setDragging(true);
        }
        if (g.moved && transformRef.current.scale > 1) {
          const { transform: start } = g.pan;
          apply(clampTransform({ ...start, x: start.x + dx, y: start.y + dy }, m.content, m.stage), false);
        }
      }
    },

    onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g.pointers.has(e.pointerId)) return;
      g.pointers.delete(e.pointerId);
      setDragging(false);

      const wasTap = !g.moved && g.pointers.size === 0 && g.down !== null;
      const down = g.down;
      // A finger lifting out of a pinch re-bases the remaining one as a pan.
      startPinchOrPan();
      if (g.pointers.size === 0) g.down = null;
      if (!wasTap || !down) return;

      const now = e.timeStamp;
      const point = { x: e.clientX, y: e.clientY };
      const last = g.lastTap;
      if (last && now - last.time < DOUBLE_TAP_MS && distance(last.point, point) < DOUBLE_TAP_DISTANCE) {
        g.lastTap = null;
        zoomTo(transformRef.current.scale > 1 ? 1 : DOUBLE_TAP_SCALE, point, true);
        return;
      }
      g.lastTap = { time: now, point };

      // A tap on the bare backdrop (not the image) closes — but only from the
      // fit view, so releasing a pan drag over the backdrop never does.
      if (down.atFit && down.target === e.currentTarget) onBackdropTap();
    },

    onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      g.pointers.delete(e.pointerId);
      g.moved = true;
      setDragging(false);
      startPinchOrPan();
      if (g.pointers.size === 0) g.down = null;
    },
  };

  return {
    surfaceRef,
    contentRef,
    transform,
    animated,
    dragging,
    handlers,
    zoomIn,
    zoomOut,
    reset,
  };
}
