"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronRight, FileText, FolderOpen, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useCanvasActions } from "@/components/canvas/canvas-actions-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  createFileLibraryAction,
  deleteFileLibraryAction,
  getFileLibraryPreview,
  type FileLibraryPreview,
} from "@/lib/actions/files";
import { formatFileSize, pdfThumbnailUrl } from "@/lib/canvas/document-file";
import { unwrapAction } from "@/lib/query-utils";

interface FilesWidgetProps {
  id: string;
  libraryId?: string;
  slug?: string;
  canWrite: boolean;
  initialPreview?: FileLibraryPreview;
}

export function FilesWidget({ id, libraryId, slug, canWrite, initialPreview }: FilesWidgetProps) {
  if (!libraryId) {
    return <DraftLibraryForm id={id} canWrite={canWrite} />;
  }
  return <FilesCard id={id} libraryId={libraryId} slug={slug} canWrite={canWrite} initialPreview={initialPreview} />;
}

/** Same "starts as a name form, becomes the card" shape the gallery widget
 *  uses — the library row exists the moment the name is submitted. */
function DraftLibraryForm({ id, canWrite }: { id: string; canWrite: boolean }) {
  const { updateWidgetData, deleteWidget } = useCanvasActions();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (libraryName: string) => unwrapAction(createFileLibraryAction(libraryName)),
    onSuccess: (res) => updateWidgetData(id, { libraryId: res.id }),
    onError: (err) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Give the library a name.");
      return;
    }
    createMutation.mutate(name.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="widget-card-shell flex h-full flex-col justify-between gap-3 p-3.5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/15 bg-white/10 shadow-inner">
            <FolderOpen className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-widget-text-primary">New Files</h3>
            <p className="text-[11px] text-widget-text-secondary">A place for PDFs and Word docs</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-1.5 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Specs & Contracts"
          autoFocus
          className="nodrag rounded-xl border-widget-border bg-widget-surface px-3 py-2 text-[12.5px] text-widget-text-primary placeholder:text-widget-text-muted focus-visible:ring-white/30"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        {canWrite && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => deleteWidget(id)}
            className="text-widget-text-secondary hover:text-widget-text-primary"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="default"
          size="sm"
          disabled={createMutation.isPending}
          badgeIcon={<Plus className="h-3.5 w-3.5" />}
        >
          {createMutation.isPending ? "Creating…" : "Create Files"}
        </Button>
      </div>
    </form>
  );
}

function FilesCard({
  id,
  libraryId,
  slug,
  canWrite,
  initialPreview,
}: {
  id: string;
  libraryId: string;
  slug?: string;
  canWrite: boolean;
  initialPreview?: FileLibraryPreview;
}) {
  const { deleteWidget } = useCanvasActions();
  const {
    data: preview,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["fileLibraryPreview", libraryId],
    queryFn: () => getFileLibraryPreview(libraryId),
    initialData: initialPreview,
  });

  const deleteMutation = useMutation({
    mutationFn: () => unwrapAction(deleteFileLibraryAction(libraryId)),
    onSuccess: () => deleteWidget(id),
    onError: (err) => console.error("Failed to delete library:", err),
  });

  function handleDeleteLibrary() {
    if (!window.confirm("Delete this library and every document in it? This can't be undone.")) return;
    deleteMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="widget-card-shell flex h-full flex-col justify-between p-3">
        <Skeleton className="h-36 w-full rounded-xl bg-white/10" />
        <div className="flex items-center justify-between pt-2">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-28 bg-white/10" />
            <Skeleton className="h-3 w-16 bg-white/10" />
          </div>
          <Skeleton className="h-8 w-8 rounded-full bg-white/10" />
        </div>
      </div>
    );
  }

  if (isError || !preview) {
    return (
      <div className="widget-card-shell flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-destructive">
        <AlertCircle className="h-5 w-5 opacity-80" />
        <span>Couldn&apos;t load this library.</span>
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full rounded-2xl">
        <FilesCardBody preview={preview} slug={slug} libraryId={libraryId} />
      </ContextMenuTrigger>
      <ContextMenuContent>
        {canWrite && (
          <ContextMenuItem variant="destructive" onClick={handleDeleteLibrary}>
            <Trash2 className="h-3.5 w-3.5" /> Delete library
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FilesCardBody({
  preview,
  slug,
  libraryId,
}: {
  preview: FileLibraryPreview;
  slug?: string;
  libraryId: string;
}) {
  const { name, count, files } = preview;
  const cover = files[0];
  const rest = files.slice(1);

  return (
    <div className="group widget-card-shell relative flex h-full w-full flex-col justify-between overflow-hidden p-2.5">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-widget-surface">
        {cover ? (
          <>
            {cover.kind === "pdf" ? (
              // eslint-disable-next-line @next/next/no-img-element -- Cloudinary delivery URL, next/image needs a fixed allowlist
              <img
                src={pdfThumbnailUrl(cover.url)}
                alt=""
                className="h-full w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#161b22] to-[#0e1117]">
                <FileText className="h-9 w-9 text-[#8ab4f8]" />
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0e1117] via-[#0e1117]/50 to-transparent" />
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#161b22] to-[#0e1117] p-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-zinc-300">
              <FolderOpen className="h-5 w-5 opacity-75" />
            </div>
            <span className="text-[11.5px] font-medium text-widget-text-secondary">No documents yet</span>
          </div>
        )}

        <div className="widget-badge-glass absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium shadow-lg">
          <FileText className="h-3 w-3 text-zinc-300" />
          <span>{count}</span>
        </div>

        {/* The most recent documents by name — a stack of thumbnails would be
            unreadable here, and a document is identified by its name far more
            than by what its first page looks like. */}
        {rest.length > 0 && (
          <div className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1">
            {rest.slice(0, 2).map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/45 px-2 py-1 backdrop-blur-sm"
              >
                <FileText className={`h-3 w-3 shrink-0 ${file.kind === "word" ? "text-[#8ab4f8]" : "text-[#f28b82]"}`} />
                <span className="truncate text-[10.5px] text-zinc-200">{file.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[9.5px] text-zinc-400">
                  {formatFileSize(file.bytes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative z-10 flex items-center justify-between gap-3 px-1 pt-2.5 pb-0.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold text-widget-text-primary transition-colors group-hover:text-white">
            {name}
          </h3>
          <p className="text-[11px] font-medium text-widget-text-secondary">
            {count} {count === 1 ? "document" : "documents"}
          </p>
        </div>

        <Link href={slug ? `/workspace/${slug}/files/${libraryId}` : "#"} title="Open files" className="nodrag">
          <Button type="button" variant="default" size="icon-xs" className="cursor-pointer">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
