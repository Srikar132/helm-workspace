"use client";

import { AlertCircle, Copy, Download, ImageDown, Maximize2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCanvasActions } from "@/components/canvas/canvas-actions-context";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { copyImage, copyLink, downloadItem } from "@/components/gallery/image-actions";
import { ImageViewerOverlay } from "@/components/gallery/image-viewer-overlay";
import { toastManager } from "@/lib/toast";
import { uploadToCloudinary } from "@/lib/upload-client";

interface MediaWidgetProps {
  id: string;
  data?: Record<string, unknown>;
  canWrite: boolean;
}

type MediaData =
  | { status: "uploading" }
  | { status: "ready"; url: string; resourceType: "image" | "video" }
  | { status: "error"; message: string };

const MAX_MEDIA_DIMENSION = 420;
const MIN_MEDIA_DIMENSION = 120;

/** Scales the source dimensions to fit the node inside a sane size range,
 *  preserving aspect ratio either way — down if the long edge is too big,
 *  up if the short edge is too small. */
function fitToAspect(width: number, height: number): { width: number; height: number } {
  const shrink = Math.min(MAX_MEDIA_DIMENSION / Math.max(width, height), 1);
  const grow = Math.max(MIN_MEDIA_DIMENSION / Math.min(width, height), 1);
  const scale = shrink < 1 ? shrink : grow;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function readMediaData(data: Record<string, unknown> | undefined): MediaData {
  if (data?.status === "ready" && typeof data.url === "string") {
    return { status: "ready", url: data.url, resourceType: data.resourceType === "video" ? "video" : "image" };
  }
  if (data?.status === "error") {
    return { status: "error", message: typeof data.message === "string" ? data.message : "Upload failed." };
  }
  return { status: "uploading" };
}

export function MediaWidget({ id, data, canWrite }: MediaWidgetProps) {
  const { updateWidgetData, deleteWidget, getPendingFile, clearPendingFile, resizeWidget } =
    useCanvasActions();
  const media = readMediaData(data);
  const [progress, setProgress] = useState(0);
  const startedRef = useRef(false);
  const [viewing, setViewing] = useState(false);

  function upload(file: File) {
    setProgress(0);
    uploadToCloudinary(file, setProgress)
      .then((result) => {
        clearPendingFile(id);
        updateWidgetData(id, { status: "ready", url: result.url, resourceType: result.resourceType });
        if (result.width && result.height) {
          resizeWidget(id, fitToAspect(result.width, result.height));
        }
      })
      .catch((err: Error) => {
        startedRef.current = false;
        updateWidgetData(id, { status: "error", message: err.message });
        toastManager.add({ title: "Upload failed", description: err.message, type: "error" });
      });
  }

  useEffect(() => {
    if (media.status !== "uploading" || startedRef.current) return;
    const file = getPendingFile(id);
    if (!file) {
      updateWidgetData(id, { status: "error", message: "Upload was lost — remove this and paste again." });
      return;
    }
    startedRef.current = true;
    // Legitimate kick-off-external-work-on-mount pattern (same precedent as
    // mail-summary-widget's fetch-on-mount) — there's no prop/state this
    // upload could be derived from during render, it's an XHR against
    // Cloudinary triggered by the file this widget was created to carry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    upload(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.status]);

  function retry() {
    const file = getPendingFile(id);
    if (!file) {
      updateWidgetData(id, { status: "error", message: "Upload was lost — remove this and paste again." });
      return;
    }
    startedRef.current = true;
    updateWidgetData(id, { status: "uploading" });
    upload(file);
  }

  if (media.status === "uploading") {
    // Shaped like where the image/video itself will end up (fills the
    // card) rather than a generic centered spinner — the progress bar still
    // carries the one thing a skeleton can't (actual upload percentage).
    return (
      <div className="relative h-full w-full overflow-hidden rounded-2xl">
        <Skeleton className="absolute inset-0 rounded-2xl bg-white/5" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4 text-center">
          <div className="w-full max-w-[180px] overflow-hidden rounded-full bg-black/40 border border-white/10">
            <div
              className="h-1 rounded-full bg-zinc-200 transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[11.5px] text-widget-text-primary">Uploading… {progress}%</p>
        </div>
      </div>
    );
  }

  if (media.status === "error") {
    return (
      <div className="widget-card-shell flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <p className="text-[12px] text-destructive">{media.message}</p>
        {canWrite && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={retry}
            >
              Retry
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={() => deleteWidget(id)}
            >
              Remove
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { url, resourceType } = media;
  const item = { url, kind: resourceType };

  return (
    <>
    <ContextMenu>
      {/* No "nodrag" here on purpose — this widget is chromeless (no header
          bar), so grabbing the media itself is how the node gets repositioned. */}
      <ContextMenuTrigger className="flex h-full w-full items-center justify-center overflow-hidden bg-black/20">
        {resourceType === "video" ? (
          <video src={url} controls className="h-full w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            onDoubleClick={() => setViewing(true)}
            className="h-full w-full object-contain"
          />
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {resourceType === "image" && (
          <ContextMenuItem onClick={() => setViewing(true)}>
            <Maximize2 className="h-3.5 w-3.5" /> View full size
          </ContextMenuItem>
        )}
        {resourceType === "image" && (
          <ContextMenuItem onClick={() => void copyImage(item)}>
            <ImageDown className="h-3.5 w-3.5" /> Copy image
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => void copyLink(item)}>
          <Copy className="h-3.5 w-3.5" /> Copy link
        </ContextMenuItem>
        <ContextMenuItem onClick={() => downloadItem(item)}>
          <Download className="h-3.5 w-3.5" /> Download
        </ContextMenuItem>
        {canWrite && (
          <ContextMenuItem variant="destructive" onClick={() => deleteWidget(id)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
    {viewing && resourceType === "image" && <ImageViewerOverlay image={item} onClose={() => setViewing(false)} />}
    </>
  );
}
