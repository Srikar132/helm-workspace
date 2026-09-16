"use client";

import { AlertCircle, Download, FileText, Link as LinkIcon, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCanvasActions } from "@/components/canvas/canvas-actions-context";
import { DocumentViewerOverlay } from "@/components/canvas/document-viewer-overlay";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  classifyDocumentFile,
  DOCUMENT_ACCEPT,
  DOCUMENT_TYPE_ERROR,
  formatFileSize,
  pdfThumbnailUrl,
  readDocumentData,
  type DocumentData,
} from "@/lib/canvas/document-file";
import { toastManager } from "@/lib/toast";
import { uploadToCloudinary } from "@/lib/upload-client";

interface DocumentWidgetProps {
  id: string;
  data?: Record<string, unknown>;
  canWrite: boolean;
}

const MAX_BYTES = 25 * 1024 * 1024;

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function DocumentWidget({ id, data, canWrite }: DocumentWidgetProps) {
  const { updateWidgetData, deleteWidget, getPendingFile, clearPendingFile } = useCanvasActions();
  const doc = readDocumentData(data);
  const [progress, setProgress] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  // The File for the upload in flight. A widget born from a paste/drop finds it
  // in the canvas's pending-file map; one born from the picker below never goes
  // through that map at all, since the file arrives after the widget exists.
  const fileRef = useRef<File | null>(null);
  const startedRef = useRef(false);

  function upload(file: File) {
    setProgress(0);
    fileRef.current = file;
    const kind = classifyDocumentFile(file.type, file.name);
    uploadToCloudinary(file, setProgress)
      .then((result) => {
        clearPendingFile(id);
        updateWidgetData(id, {
          status: "ready",
          url: result.url,
          // Stored so deleteWidgetAction can destroy the Cloudinary asset
          // instead of leaving it orphaned once the row is gone.
          cloudinaryPublicId: result.publicId,
          kind: kind ?? "pdf",
          name: file.name,
          bytes: result.bytes ?? file.size,
        });
      })
      .catch((err: Error) => {
        startedRef.current = false;
        updateWidgetData(id, { status: "error", message: err.message });
        toastManager.add({ title: "Upload failed", description: err.message, type: "error" });
      });
  }

  useEffect(() => {
    if (doc.status !== "uploading" || startedRef.current) return;
    const file = fileRef.current ?? getPendingFile(id);
    if (!file) {
      updateWidgetData(id, { status: "error", message: "Upload was lost — remove this and add the file again." });
      return;
    }
    startedRef.current = true;
    // Same kick-off-external-work-on-mount pattern MediaWidget uses: this is an
    // XHR against Cloudinary for the file this widget was created to carry,
    // not state derivable from a prop during render.
    upload(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.status]);

  function accept(file: File | undefined | null) {
    if (!file) return;
    if (!classifyDocumentFile(file.type, file.name)) {
      toastManager.add({ title: "Unsupported file", description: DOCUMENT_TYPE_ERROR, type: "error" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toastManager.add({ title: "File is too large", description: "Maximum size is 25MB.", type: "error" });
      return;
    }
    fileRef.current = file;
    startedRef.current = true;
    updateWidgetData(id, { status: "uploading" });
    upload(file);
  }

  function retry() {
    const file = fileRef.current ?? getPendingFile(id);
    if (!file) {
      updateWidgetData(id, { status: "error", message: "Upload was lost — remove this and add the file again." });
      return;
    }
    startedRef.current = true;
    updateWidgetData(id, { status: "uploading" });
    upload(file);
  }

  if (doc.status === "empty") {
    return <DocumentPicker id={id} canWrite={canWrite} onFile={accept} />;
  }

  if (doc.status === "uploading") {
    return (
      <div className="widget-card-shell flex h-full items-stretch overflow-hidden">
        <div className="flex w-[34%] shrink-0 items-center justify-center border-r border-widget-border bg-widget-surface">
          <Skeleton className="h-9 w-9 rounded-md bg-white/10" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 p-4">
          <Skeleton className="h-3.5 w-4/5 bg-white/10" />
          <div className="w-full overflow-hidden rounded-full border border-white/10 bg-black/40">
            <div
              className="h-1 rounded-full bg-zinc-200 transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[11.5px] text-widget-text-secondary">Uploading… {progress}%</p>
        </div>
      </div>
    );
  }

  if (doc.status === "error") {
    return (
      <div className="widget-card-shell flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <p className="text-[12px] text-destructive">{doc.message}</p>
        {canWrite && (
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="xs" onClick={retry}>
              Retry
            </Button>
            <Button type="button" variant="destructive" size="xs" onClick={() => deleteWidget(id)}>
              Remove
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <DocumentCard
        doc={doc}
        canWrite={canWrite}
        onOpen={() => (doc.kind === "pdf" ? setViewerOpen(true) : download(doc.url, doc.name))}
        onDelete={() => deleteWidget(id)}
      />
      {viewerOpen && doc.kind === "pdf" && (
        <DocumentViewerOverlay url={doc.url} name={doc.name} onClose={() => setViewerOpen(false)} />
      )}
    </>
  );
}

/** The card's first life: no file yet, because it was added from the toolbar
 *  rather than born from a drop. Same "starts as a form, becomes the card"
 *  shape as the bookmark and project-doc widgets. */
function DocumentPicker({
  id,
  canWrite,
  onFile,
}: {
  id: string;
  canWrite: boolean;
  onFile: (file: File | undefined | null) => void;
}) {
  const { deleteWidget } = useCanvasActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  if (!canWrite) {
    return (
      <div className="widget-card-shell flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <FileText className="h-5 w-5 text-zinc-500" />
        <p className="text-[11.5px] text-widget-text-secondary">No document yet.</p>
      </div>
    );
  }

  return (
    <div
      // `nodrag` on the drop target only — the card's padding stays a drag
      // surface, so the widget can still be repositioned by grabbing its edge.
      className="widget-card-shell flex h-full flex-col gap-2.5 p-3.5"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        // The canvas's own drop handler would otherwise ALSO see this and
        // create a second widget next to this one.
        e.stopPropagation();
        setDragging(false);
        onFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-zinc-300" />
        <span className="text-[12.5px] font-medium text-widget-text-primary">New Document</span>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`nodrag flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors ${
          dragging
            ? "border-white/40 bg-white/10"
            : "border-widget-border bg-widget-surface hover:border-white/20 hover:bg-widget-surface-hover"
        }`}
      >
        <Upload className="h-4 w-4 text-zinc-400" />
        <span className="text-[12px] text-widget-text-primary">Choose a PDF or Word file</span>
        <span className="text-[11px] text-widget-text-secondary">or drop one here — max 25MB</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          // Reset so picking the same file twice after a failure still fires.
          e.target.value = "";
        }}
      />

      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => deleteWidget(id)}
          className="text-widget-text-secondary hover:text-widget-text-primary"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DocumentCard({
  doc,
  canWrite,
  onOpen,
  onDelete,
}: {
  doc: Extract<DocumentData, { status: "ready" }>;
  canWrite: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const showThumbnail = doc.kind === "pdf" && !thumbnailFailed;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="group widget-card-shell flex h-full items-stretch overflow-hidden">
        {/* Preview band doubles as the drag handle — same division of labour as
            the bookmark card, where the icon column is grabbable and the text
            column is the link. */}
        <div className="flex w-[34%] shrink-0 items-center justify-center overflow-hidden rounded-l-2xl border-r border-widget-border bg-widget-surface">
          {showThumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- Cloudinary delivery URL, next/image needs a fixed allowlist
            <img
              src={pdfThumbnailUrl(doc.url)}
              alt=""
              onError={() => setThumbnailFailed(true)}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <FileText className={`h-7 w-7 ${doc.kind === "word" ? "text-[#8ab4f8]" : "text-[#f28b82]"}`} />
          )}
        </div>

        <button
          type="button"
          onClick={onOpen}
          title={doc.kind === "pdf" ? "Open document" : "Download document"}
          className="nodrag flex min-w-0 flex-1 cursor-pointer flex-col justify-between gap-2 p-4 text-left"
        >
          <h3 className="line-clamp-2 text-[13.5px] leading-snug font-semibold text-widget-text-primary">
            {doc.name}
          </h3>
          <p className="mt-auto truncate font-mono text-[11px] text-zinc-400 transition-colors group-hover:text-zinc-300">
            {doc.kind === "pdf" ? "PDF" : "Word"} · {formatFileSize(doc.bytes)}
          </p>
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={onOpen}>
          <FileText className="h-3.5 w-3.5" /> {doc.kind === "pdf" ? "Open" : "Download"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => download(doc.url, doc.name)}>
          <Download className="h-3.5 w-3.5" /> Download
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(doc.url)}>
          <LinkIcon className="h-3.5 w-3.5" /> Copy link
        </ContextMenuItem>
        {canWrite && (
          <ContextMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
