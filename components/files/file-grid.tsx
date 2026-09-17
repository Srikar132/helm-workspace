"use client";

import { AlertCircle, Check, Download, FileText, FolderInput, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFileMutations } from "@/components/files/use-file-mutations";
import type { FileFolderRow, LibraryFileRow } from "@/lib/actions/files";
import { formatFileSize, pdfThumbnailUrl } from "@/lib/canvas/document-file";
import type { PendingUpload } from "@/components/files/use-file-upload";

interface FileGridProps {
  files: LibraryFileRow[];
  folders: FileFolderRow[];
  pendingUploads: PendingUpload[];
  onDismissPending: (id: string) => void;
  selectedIds: Set<string>;
  selectionMode: boolean;
  canWrite: boolean;
  isSwitching: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onToggleSelect: (id: string) => void;
  onOpen: (file: LibraryFileRow) => void;
  onRefresh: () => void;
}

export function downloadFile(file: Pick<LibraryFileRow, "url" | "name">) {
  const a = document.createElement("a");
  a.href = file.url;
  a.download = file.name;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function FileGrid({
  files,
  folders,
  pendingUploads,
  onDismissPending,
  selectedIds,
  selectionMode,
  canWrite,
  isSwitching,
  hasMore,
  loadingMore,
  onLoadMore,
  onToggleSelect,
  onOpen,
  onRefresh,
}: FileGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Pages in as the end of the list comes into view, rather than on a button —
  // same reason the album grid does it: a library is scrolled, not paged.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) onLoadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, files.length]);

  if (isSwitching && files.length === 0 && pendingUploads.length === 0) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
    );
  }

  if (files.length === 0 && pendingUploads.length === 0) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-[13px] font-medium text-foreground">Nothing here yet</p>
        <p className="text-[12px] text-muted-foreground">
          {canWrite ? "Drop a PDF or Word file anywhere on this page." : "No documents in this folder."}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {pendingUploads.map((pending) => (
          <PendingTile key={pending.id} pending={pending} onDismiss={() => onDismissPending(pending.id)} />
        ))}

        {files.map((file) => (
          <FileTile
            key={file.id}
            file={file}
            folders={folders}
            selected={selectedIds.has(file.id)}
            selectionMode={selectionMode}
            canWrite={canWrite}
            onToggleSelect={() => onToggleSelect(file.id)}
            onOpen={() => onOpen(file)}
            onRefresh={onRefresh}
          />
        ))}
      </div>

      <div ref={sentinelRef} className="h-8" />
      {loadingMore && <p className="py-2 text-center text-[12px] text-muted-foreground">Loading more…</p>}
    </>
  );
}

function PendingTile({ pending, onDismiss }: { pending: PendingUpload; onDismiss: () => void }) {
  return (
    <div className="relative flex h-44 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {pending.error ? (
          <AlertCircle className="h-6 w-6 text-destructive" />
        ) : (
          <div className="w-[70%] overflow-hidden rounded-full border border-white/10 bg-black/40">
            <div
              className="h-1 rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${pending.progress}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t border-white/[0.06] px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{pending.name}</span>
        {pending.error ? (
          <button
            type="button"
            onClick={onDismiss}
            title={pending.error}
            className="shrink-0 cursor-pointer text-destructive hover:text-destructive/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{pending.progress}%</span>
        )}
      </div>
    </div>
  );
}

function FileTile({
  file,
  folders,
  selected,
  selectionMode,
  canWrite,
  onToggleSelect,
  onOpen,
  onRefresh,
}: {
  file: LibraryFileRow;
  folders: FileFolderRow[];
  selected: boolean;
  selectionMode: boolean;
  canWrite: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onRefresh: () => void;
}) {
  const { rename, remove, move } = useFileMutations(onRefresh);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(file.name);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  const showThumbnail = file.kind === "pdf" && !thumbnailFailed;

  function handleDelete() {
    if (!window.confirm(`Delete "${file.name}"? This can't be undone.`)) return;
    remove.mutate(file.id);
  }

  return (
    <div
      className={`group relative flex h-44 cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white/[0.02] transition-colors ${
        selected ? "border-primary ring-2 ring-primary/40" : "border-white/[0.08] hover:border-white/20"
      }`}
      onClick={() => (selectionMode ? onToggleSelect() : onOpen())}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black/20">
        {showThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- Cloudinary delivery URL, next/image needs a fixed allowlist
          <img
            src={pdfThumbnailUrl(file.url)}
            alt=""
            onError={() => setThumbnailFailed(true)}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FileText className={`h-8 w-8 ${file.kind === "word" ? "text-[#8ab4f8]" : "text-[#f28b82]"}`} />
          </div>
        )}

        {selectionMode && (
          <div
            className={`absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-md border ${
              selected ? "border-primary bg-primary text-primary-foreground" : "border-white/40 bg-black/40"
            }`}
          >
            {selected && <Check className="h-3 w-3" />}
          </div>
        )}

        {canWrite && !selectionMode && (
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              className="absolute top-2 right-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-zinc-200 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={onOpen}>
                <FileText className="h-3.5 w-3.5" /> {file.kind === "pdf" ? "Open" : "Download"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadFile(file)}>
                <Download className="h-3.5 w-3.5" /> Download
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setValue(file.name);
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Rename
              </DropdownMenuItem>
              {file.folderId && (
                <DropdownMenuItem onClick={() => move.mutate({ id: file.id, folderId: null })}>
                  <FolderInput className="h-3.5 w-3.5" /> Remove from folder
                </DropdownMenuItem>
              )}
              {folders
                .filter((folder) => folder.id !== file.folderId)
                .map((folder) => (
                  <DropdownMenuItem key={folder.id} onClick={() => move.mutate({ id: file.id, folderId: folder.id })}>
                    <FolderInput className="h-3.5 w-3.5" /> Move to {folder.name}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex flex-col gap-0.5 border-t border-white/[0.06] px-2.5 py-2" onClick={(e) => editing && e.stopPropagation()}>
        {editing ? (
          <input
            type="text"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              setEditing(false);
              if (value.trim() && value.trim() !== file.name) rename.mutate({ id: file.id, name: value.trim() });
              else setValue(file.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setValue(file.name);
                setEditing(false);
              }
            }}
            className="w-full rounded-md border border-primary/40 bg-white/5 px-1.5 py-1 text-[12px] text-foreground outline-none"
          />
        ) : (
          <span className="truncate text-[12px] font-medium text-foreground">{file.name}</span>
        )}
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {file.kind === "pdf" ? "PDF" : "Word"} · {formatFileSize(file.bytes)}
        </span>
      </div>
    </div>
  );
}
