"use client";

import { Copy, Download, ImageDown, X } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { copyImage, copyLink, downloadItem } from "@/components/gallery/image-actions";
import { useModalDialog } from "@/components/gallery/use-modal-dialog";
import { ZoomableImage, type ViewerImage } from "@/components/gallery/zoomable-image";

/**
 * Zoom / pan viewer for ONE image that isn't part of a gallery (a canvas image
 * widget). The gallery `Lightbox` needs a list, groups and mutations that a lone
 * image doesn't have, so this is the same stage in a thinner shell.
 *
 * Portalled to <body>: a canvas node lives inside xyflow's transformed
 * viewport, and `position: fixed` under a transformed ancestor is laid out
 * against that ancestor, not the screen. React events bubble through portals
 * to React parents, so the root also stops them — otherwise a drag or click in
 * the viewer would reach the widget and canvas underneath.
 */
export function ImageViewerOverlay({ image, onClose }: { image: ViewerImage; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalDialog({ dialogRef, closeRef, onClose });

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={image.name || "Image"}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onKeyDown={stop}
      className="fixed inset-0 z-[100] flex flex-col bg-black/92"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] p-3 sm:p-4">
        <span className="truncate text-[12.5px] text-white/70">{image.name || "Image"}</span>
        <Button
          ref={closeRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close viewer"
          onClick={onClose}
          className="rounded-full text-white/70 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <ZoomableImage image={image} onBackdropTap={onClose} onZoomedChange={noop} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5 p-3 sm:p-4">
        <ViewerAction icon={ImageDown} label="Copy image" onClick={() => void copyImage(image)} />
        <ViewerAction icon={Copy} label="Copy link" onClick={() => void copyLink(image)} />
        <ViewerAction icon={Download} label="Download" onClick={() => downloadItem(image)} />
      </div>
    </div>,
    document.body,
  );
}

function noop() {}

function ViewerAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="h-auto min-h-9 min-w-9 justify-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-white hover:bg-white/20"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
