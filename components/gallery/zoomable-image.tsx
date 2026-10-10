"use client";

import { AlertCircle, Download, Loader2, Maximize2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadItem } from "@/components/gallery/image-actions";
import { usePanZoom } from "@/components/gallery/use-pan-zoom";
import { MAX_SCALE } from "@/lib/pan-zoom";

/** The slice of an image the stage needs — a gallery row or a canvas widget. */
export interface ViewerImage {
  url: string;
  name?: string | null;
  kind: string;
}

interface ZoomableImageProps {
  image: ViewerImage;
  /** A tap on the empty backdrop at the fit view. */
  onBackdropTap: () => void;
  /** Tells the lightbox whether arrows should pan (zoomed) or change photo. */
  onZoomedChange: (zoomed: boolean) => void;
}

type LoadState = "loading" | "loaded" | "error";

/**
 * The lightbox stage for one photo. Mount it with `key={image.id}` — pan/zoom
 * and load state then reset on every photo change without any syncing.
 */
export function ZoomableImage({ image, onBackdropTap, onZoomedChange }: ZoomableImageProps) {
  const { surfaceRef, contentRef, transform, animated, dragging, handlers, zoomIn, zoomOut, reset } = usePanZoom({
    onBackdropTap,
  });
  const [status, setStatus] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);

  const zoomed = transform.scale > 1;
  useEffect(() => {
    onZoomedChange(zoomed);
    return () => onZoomedChange(false);
  }, [zoomed, onZoomedChange]);

  // A retry must dodge the browser's cached failure, so it changes the URL.
  const src = attempt === 0 ? image.url : `${image.url}${image.url.includes("?") ? "&" : "?"}retry=${attempt}`;

  function retry() {
    setStatus("loading");
    setAttempt((n) => n + 1);
  }

  return (
    <div className="absolute inset-0">
      <div
        ref={surfaceRef}
        {...handlers}
        // touch-none: the browser must not scroll or page-zoom under a pinch.
        className="absolute inset-0 flex touch-none select-none items-center justify-center overflow-hidden px-4"
        style={{ cursor: dragging ? "grabbing" : zoomed ? "grab" : "default" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external Cloudinary domain */}
        <img
          ref={contentRef}
          src={src}
          alt={image.name ?? ""}
          draggable={false}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={`max-h-full max-w-full rounded-lg object-contain shadow-2xl motion-reduce:transition-none ${
            status === "loaded" ? "opacity-100" : "opacity-0"
          } ${animated ? "transition-transform duration-150 ease-out" : ""}`}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            willChange: "transform",
            // iOS Safari otherwise offers "Save image" on a long press mid-pan.
            WebkitTouchCallout: "none",
          }}
        />
      </div>

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
          <span className="sr-only">Loading image…</span>
        </div>
      )}

      {status === "error" && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white"
        >
          <AlertCircle className="h-7 w-7 text-white/70" />
          <p className="text-[13px] text-white/80">This image couldn&apos;t be loaded.</p>
          <div className="flex gap-2">
            <ViewerButton icon={RotateCw} label="Retry" showLabel onClick={retry} />
            <ViewerButton icon={Download} label="Download" showLabel onClick={() => downloadItem(image)} />
          </div>
        </div>
      )}

      {status === "loaded" && (
        <div
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-black/50 p-1 backdrop-blur-sm sm:bottom-4 sm:right-4"
          role="group"
          aria-label="Zoom"
        >
          <ViewerButton icon={ZoomOut} label="Zoom out" disabled={transform.scale <= 1} onClick={zoomOut} />
          <span className="min-w-10 text-center text-[11.5px] tabular-nums text-white/70" aria-live="polite">
            {Math.round(transform.scale * 100)}%
          </span>
          <ViewerButton icon={ZoomIn} label="Zoom in" disabled={transform.scale >= MAX_SCALE} onClick={zoomIn} />
          <ViewerButton icon={Maximize2} label="Fit to screen" disabled={!zoomed} onClick={reset} />
        </div>
      )}
    </div>
  );
}

function ViewerButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  showLabel,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="gap-1.5 rounded-full text-white/80 hover:bg-white/15 hover:text-white disabled:opacity-30"
    >
      <Icon className="h-4 w-4" />
      {showLabel && <span className="text-[12.5px]">{label}</span>}
    </Button>
  );
}
