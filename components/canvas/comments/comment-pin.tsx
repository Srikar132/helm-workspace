"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CommentAvatar } from "@/components/canvas/comments/comment-avatar";
import { isPinDrag } from "@/lib/comments";
import { cn } from "@/lib/utils";

interface CommentPinProps {
  x: number;
  y: number;
  zoom: number;
  authorName: string | null;
  authorImage: string | null;
  preview?: string;
  replyCount?: number;
  resolved?: boolean;
  active?: boolean;
  justPlaced?: boolean;
  canMove?: boolean;
  onOpen: () => void;
  onMove?: (x: number, y: number) => void;
}

/**
 * A comment on the canvas: a speech-bubble teardrop whose one sharp corner
 * sits exactly on the commented spot. Counter-scaled by 1/zoom so it stays the
 * same on-screen size at any zoom. Hovering expands it into a one-line preview.
 *
 * Positioned from a zero-size anchor at (x, y) — scaling around that point
 * keeps the sharp corner pinned while the bubble grows up and to the right.
 */
export function CommentPin({
  x,
  y,
  zoom,
  authorName,
  authorImage,
  preview,
  replyCount = 0,
  resolved,
  active,
  justPlaced,
  canMove,
  onOpen,
  onMove,
}: CommentPinProps) {
  const press = useRef<{ id: number; startX: number; startY: number } | null>(null);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    // Keep xyflow from starting a pan or marquee under the pin.
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    if (!p || p.id !== e.pointerId || !canMove) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (drag || isPinDrag(dx, dy)) setDrag({ dx: dx / zoom, dy: dy / zoom });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag) {
      onMove?.(Math.round(x + drag.dx), Math.round(y + drag.dy));
      setDrag(null);
    } else {
      onOpen();
    }
  }

  function onPointerCancel() {
    press.current = null;
    setDrag(null);
  }

  const left = x + (drag?.dx ?? 0);
  const top = y + (drag?.dy ?? 0);
  const expandable = !active && !drag && Boolean(preview);

  return (
    <div
      className="absolute h-0 w-0"
      style={{ left, top, transform: `scale(${1 / zoom})`, transformOrigin: "0 0", zIndex: active || drag ? 1101 : 1100 }}
    >
      <button
        type="button"
        data-comment-pin
        aria-label={`Comment by ${authorName ?? "someone"}${replyCount ? `, ${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : ""}`}
        aria-expanded={active}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        // Keyboard activation (pointer clicks are handled on pointer-up).
        onClick={(e) => e.detail === 0 && onOpen()}
        className={cn(
          "nopan nodrag nowheel group pointer-events-auto absolute bottom-0 left-0 flex max-w-[280px] items-center gap-2",
          "rounded-[18px] rounded-bl-[3px] border border-border bg-card p-1 text-left text-card-foreground",
          "shadow-[0_6px_20px_-6px_rgb(0_0_0/0.35)] outline-none transition-[box-shadow,opacity,filter] duration-150",
          "focus-visible:ring-2 focus-visible:ring-ring",
          canMove ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          active && "ring-2 ring-primary",
          resolved && !active && "opacity-60 saturate-0",
          drag && "shadow-[0_14px_30px_-8px_rgb(0_0_0/0.45)]",
          justPlaced && "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-200",
        )}
        style={{ transformOrigin: "0 100%" }}
      >
        <CommentAvatar name={authorName} image={authorImage} className="h-7 w-7 text-[12px]" />

        {expandable && (
          <span className="grid max-w-0 grid-rows-[auto_auto] overflow-hidden opacity-0 transition-[max-width,opacity,padding] duration-200 ease-out group-hover:max-w-[228px] group-hover:pr-2 group-hover:opacity-100 group-focus-visible:max-w-[228px] group-focus-visible:pr-2 group-focus-visible:opacity-100 motion-reduce:transition-none">
            <span className="truncate text-[12px] font-medium leading-tight">{authorName ?? "Deleted user"}</span>
            <span className="truncate text-[12px] leading-tight text-muted-foreground">{preview}</span>
          </span>
        )}

        {replyCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background">
            {replyCount > 99 ? "99+" : replyCount}
          </span>
        )}
      </button>
    </div>
  );
}
