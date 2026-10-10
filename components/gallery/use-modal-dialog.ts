"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true']");
}

/**
 * What every full-screen viewer owes its user: the page behind stops
 * scrolling, focus moves in and is handed back on close, Tab stays inside,
 * and Escape closes (unless the user is typing).
 *
 * Delete/Backspace are also swallowed in the CAPTURE phase on `window`. When
 * a viewer opens over the canvas, xyflow's delete-key listener is still live
 * on `document`; without this, pressing Delete to dismiss a prompt would
 * remove whichever widget was selected underneath.
 */
export function useModalDialog({
  dialogRef,
  closeRef,
  onClose,
}: {
  dialogRef: RefObject<HTMLElement | null>;
  closeRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [closeRef]);

  useEffect(() => {
    function shield(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditable(e.target)) e.stopPropagation();
    }
    function onKeyDown(e: KeyboardEvent) {
      // Typing (a rename box) must not close the viewer.
      if (isEditable(e.target)) return;
      if (e.key === "Escape") onClose();

      const dialog = dialogRef.current;
      if (e.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", shield, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", shield, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dialogRef, onClose]);
}
