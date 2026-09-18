"use client";

import { useDraggable } from "@dnd-kit/core";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Copy,
  Download,
  FileText,
  FolderInput,
  FolderOutput,
  FolderX,
  ImageOff,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PendingUpload } from "@/components/albums/use-album-upload";
import { useAlbumImageMutations } from "@/components/albums/use-album-image-mutations";
import type { AlbumGroupRow, AlbumImageRow } from "@/lib/actions/albums";
import { albumThumbnailUrl, documentLabel, formatFileSize } from "@/lib/album-file";

interface AlbumGridProps {
  items: AlbumImageRow[];
  pendingUploads: PendingUpload[];
  onDismissPending: (id: string) => void;
  selectedIds: Set<string>;
  canWrite: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (item: AlbumImageRow) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  groups: AlbumGroupRow[];
  onRefresh: () => void;
  /** True while a group-filter switch's fetch is in flight — shows skeleton
   *  tiles instead of a jarring blank grid between filters. */
  isSwitching: boolean;
  /** Forces every tile's checkbox visible (not just on hover) — the only way
   *  to discover/start bulk selection on touch devices, which have no hover. */
  selectionMode: boolean;
}

export function downloadItem(item: Pick<AlbumImageRow, "url" | "name">) {
  const a = document.createElement("a");
  a.href = item.url;
  a.download = item.name ?? "";
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function AlbumGrid({
  items,
  pendingUploads,
  onDismissPending,
  selectedIds,
  canWrite,
  onToggleSelect,
  onOpen,
  hasMore,
  loadingMore,
  onLoadMore,
  groups,
  onRefresh,
  isSwitching,
  selectionMode,
}: AlbumGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, items.length]);

  if (isSwitching) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-2xl" />
        ))}
      </div>
    );
  }

  if (items.length === 0 && pendingUploads.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03] text-muted-foreground">
          <ImageOff className="h-6 w-6" />
        </div>
        <div>
          <p className="text-[13px] text-muted-foreground">Nothing here yet.</p>
          {canWrite && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Drop images, PDFs or Word files anywhere, or use &quot;Add files&quot; above.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        {pendingUploads.map((p) => (
          <PendingTile key={p.id} pending={p} onDismiss={() => onDismissPending(p.id)} />
        ))}
        {items.map((item) => (
          <AlbumTile
            key={item.id}
            item={item}
            selected={selectedIds.has(item.id)}
            selectionActive={selectionMode || selectedIds.size > 0}
            canWrite={canWrite}
            groups={groups}
            onToggleSelect={() => onToggleSelect(item.id)}
            onOpen={() => onOpen(item)}
            onChanged={onRefresh}
          />
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="flex h-16 items-center justify-center text-[12px] text-muted-foreground">
          {loadingMore ? "Loading more…" : ""}
        </div>
      )}
    </div>
  );
}

function PendingTile({ pending, onDismiss }: { pending: PendingUpload; onDismiss: () => void }) {
  return (
    <div className="relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-card p-3 text-center">
      {pending.error ? (
        <>
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <p className="text-[11px] text-destructive">{pending.error}</p>
          <button
            type="button"
            onClick={onDismiss}
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        </>
      ) : (
        <>
          <div className="h-1 w-3/5 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${pending.progress}%` }} />
          </div>
          <p className="max-w-full truncate text-[11px] text-muted-foreground">{pending.name}</p>
          <p className="text-[11px] text-muted-foreground">Uploading… {pending.progress}%</p>
        </>
      )}
    </div>
  );
}

function AlbumTile({
  item,
  selected,
  selectionActive,
  canWrite,
  groups,
  onToggleSelect,
  onOpen,
  onChanged,
}: {
  item: AlbumImageRow;
  selected: boolean;
  selectionActive: boolean;
  canWrite: boolean;
  groups: AlbumGroupRow[];
  onToggleSelect: () => void;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(item.name ?? "");
  // A PDF's page-1 thumbnail is a Cloudinary transform that can fail on its
  // own (delivery disabled, a PDF it refuses to rasterise) — falling back to
  // the file-type card is the difference between a tile and a broken image.
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const { rename, duplicate, remove, move } = useAlbumImageMutations(onChanged);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { type: "album-item", imageId: item.id, groupId: item.groupId },
    disabled: !canWrite,
  });

  const isDocument = item.kind !== "image";
  const thumbnail = thumbnailFailed ? null : albumThumbnailUrl(item);

  async function copyLink() {
    await navigator.clipboard.writeText(item.url);
  }

  function handleClick() {
    if (selectionActive) onToggleSelect();
    else onOpen();
  }

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      whileHover={isDragging ? undefined : { scale: 1.02 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      // No in-place transform here — the tile stays put and just dims. The
      // actual moving thumbnail is DragOverlay (album-view.tsx), portalled to
      // <body> so it isn't clipped by this grid's own overflow-y-auto once
      // dragged past the container edge toward the sidebar.
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
      className="group relative aspect-square overflow-hidden rounded-2xl border border-white/[0.06] bg-card shadow-sm transition-shadow hover:shadow-lg hover:shadow-black/30"
    >
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Cloudinary domain
        <img
          src={thumbnail}
          alt={item.name ?? ""}
          onClick={handleClick}
          onError={() => setThumbnailFailed(true)}
          draggable={false}
          className={`h-full w-full cursor-pointer object-cover ${isDocument ? "object-top" : ""}`}
        />
      ) : (
        <div
          onClick={handleClick}
          className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#161b22] to-[#0e1117] p-3 text-center"
        >
          <FileText className={`h-8 w-8 ${item.kind === "word" ? "text-[#8ab4f8]" : "text-[#f28b82]"}`} />
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {documentLabel(item.kind)} · {formatFileSize(item.bytes)}
          </span>
        </div>
      )}

      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity ${
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      />

      <div className="absolute left-2 top-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className={`bg-black/40 backdrop-blur-sm transition-opacity ${
            selected || selectionActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        />
      </div>

      {canWrite && (
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 cursor-pointer"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <Pencil className="h-3.5 w-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => duplicate.mutate({ id: item.id })}>
                <FolderInput className="h-3.5 w-3.5" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void copyLink()}>
                <Copy className="h-3.5 w-3.5" /> Copy link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadItem(item)}>
                <Download className="h-3.5 w-3.5" /> Download
              </DropdownMenuItem>
              {groups.filter((g) => g.id !== item.groupId).length > 0 && (
                <>
                  <div className="my-1 h-px bg-white/[0.06]" />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderOutput className="h-3.5 w-3.5" /> Move to group
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {groups
                        .filter((g) => g.id !== item.groupId)
                        .map((g) => (
                          <DropdownMenuItem key={g.id} onClick={() => move.mutate({ id: item.id, groupId: g.id })}>
                            {g.name}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}
              {item.groupId && (
                <DropdownMenuItem onClick={() => move.mutate({ id: item.id, groupId: null })}>
                  <FolderX className="h-3.5 w-3.5" /> Remove from group
                </DropdownMenuItem>
              )}
              <div className="my-1 h-px bg-white/[0.06]" />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  if (window.confirm("Delete this file? This can't be undone.")) {
                    remove.mutate(item.id);
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {renaming && (
        <div className="absolute inset-x-0 bottom-0 bg-black/70 p-1.5">
          <input
            type="text"
            value={name}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              rename.mutate({ id: item.id, name });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="w-full rounded bg-white/10 px-1.5 py-1 text-[11.5px] text-white outline-none"
          />
        </div>
      )}

      {/* A document's name is pinned, not hover-only: it is the only thing
          telling one PDF tile from another. */}
      {!renaming && item.name && (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[11px] text-white transition-opacity ${
            isDocument ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {item.name}
        </div>
      )}
    </motion.div>
  );
}
