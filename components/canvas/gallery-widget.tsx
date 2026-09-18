"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronRight, FileText, Images, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useCanvasActions } from "@/components/canvas/canvas-actions-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { createAlbumAction, deleteAlbumAction, getAlbumPreview, type AlbumPreview } from "@/lib/actions/albums";
import { unwrapAction } from "@/lib/query-utils";
import { albumThumbnailUrl } from "@/lib/album-file";

interface GalleryWidgetProps {
  id: string;
  albumId?: string;
  slug?: string;
  canWrite: boolean;
  initialPreview?: AlbumPreview;
}

export function GalleryWidget({ id, albumId, slug, canWrite, initialPreview }: GalleryWidgetProps) {
  if (!albumId) {
    return <DraftAlbumForm id={id} canWrite={canWrite} />;
  }
  return <GalleryCard id={id} albumId={albumId} slug={slug} canWrite={canWrite} initialPreview={initialPreview} />;
}

function DraftAlbumForm({ id, canWrite }: { id: string; canWrite: boolean }) {
  const { updateWidgetData, deleteWidget } = useCanvasActions();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (albumName: string) => unwrapAction(createAlbumAction(albumName)),
    onSuccess: (res) => updateWidgetData(id, { albumId: res.id }),
    onError: (err) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Give the album a name.");
      return;
    }
    createMutation.mutate(name.trim());
  }

  return (
    <form
      onSubmit={handleSubmit}
      // See project-doc/bookmark: the shell's chrome decides nodrag/nowheel, so
      // the form no longer pins its own card in place.
      className="relative flex h-full flex-col justify-between overflow-hidden rounded-2xl bg-[#121316]/95 p-4 border border-white/[0.1] backdrop-blur-xl shadow-2xl"
    >
      <div className="absolute -top-12 -left-12 h-32 w-32 rounded-full bg-blue-500/15 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-indigo-500/15 blur-2xl pointer-events-none" />

      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 border border-white/15 shadow-inner">
            <Images className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-[#e8eaed]">New Gallery</h3>
            <p className="text-[11px] text-[#9aa0a6]">Photos, PDFs and Word files</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-1.5 rounded-xl border border-[#f28b82]/20 bg-[#f28b82]/10 px-3 py-2 text-[11.5px] text-[#f28b82]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Workspace Snapshots"
          autoFocus
          className="nodrag rounded-xl border-white/10 bg-white/[0.04] px-3 py-2 text-[12.5px] text-[#e8eaed] placeholder:text-[#5f6368] focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:border-white/30"
        />
      </div>

      <div className="relative z-10 flex items-center justify-end gap-2 pt-2">
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
          {createMutation.isPending ? "Creating…" : "Create Gallery"}
        </Button>
      </div>
    </form>
  );
}

function GalleryCard({
  id,
  albumId,
  slug,
  canWrite,
  initialPreview,
}: {
  id: string;
  albumId: string;
  slug?: string;
  canWrite: boolean;
  initialPreview?: AlbumPreview;
}) {
  const { deleteWidget } = useCanvasActions();
  const {
    data: preview,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["albumPreview", albumId],
    queryFn: () => getAlbumPreview(albumId),
    initialData: initialPreview,
  });

  const deleteMutation = useMutation({
    mutationFn: () => unwrapAction(deleteAlbumAction(albumId)),
    onSuccess: () => deleteWidget(id),
    onError: (err) => console.error("Failed to delete gallery:", err),
  });

  function handleDeleteGallery() {
    if (!window.confirm("Delete this gallery and everything in it? This can't be undone.")) return;
    deleteMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col justify-between rounded-2xl bg-[#121316] p-3 border border-white/[0.08]">
        <Skeleton className="h-36 w-full rounded-xl" />
        <div className="flex items-center justify-between pt-2">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>
    );
  }

  if (isError || !preview) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-[#f28b82] rounded-2xl bg-[#121316] border border-[#f28b82]/20">
        <AlertCircle className="h-5 w-5 opacity-80" />
        <span>Couldn&apos;t load this gallery.</span>
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full rounded-2xl">
        <GalleryCardBody preview={preview} slug={slug} albumId={albumId} />
      </ContextMenuTrigger>
      <ContextMenuContent>
        {canWrite && (
          <ContextMenuItem variant="destructive" onClick={handleDeleteGallery}>
            <Trash2 className="h-3.5 w-3.5" /> Delete gallery
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function GalleryCardBody({
  preview,
  slug,
  albumId,
}: {
  preview: AlbumPreview;
  slug?: string;
  albumId: string;
}) {
  const { name, count, images } = preview;
  // A Word file has no thumbnail Cloudinary can make (see albumThumbnailUrl),
  // so the cover falls back to the empty-gallery frame rather than a broken
  // image — the badge and count still say the album isn't empty.
  const cover = images && images.length > 0 ? images[0] : null;
  const coverImg = cover ? albumThumbnailUrl(cover) : null;
  const subImages = images && images.length > 1 ? images.slice(1) : [];
  const extraCount = count > images.length ? count - images.length : 0;

  return (
    <div className="group relative widget-card-shell flex h-full w-full flex-col justify-between overflow-hidden p-2.5">
      {/* Hero Cover Frame */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-widget-surface">
        {coverImg ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImg}
              alt={name}
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            />
            {/* Bottom Gradient Fade */}
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0e1117] via-[#0e1117]/50 to-transparent pointer-events-none" />
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#161b22] to-[#0e1117] p-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-zinc-300">
              {cover ? <FileText className="h-5 w-5 opacity-75" /> : <Images className="h-5 w-5 opacity-75" />}
            </div>
            <span className="text-[11.5px] font-medium text-widget-text-secondary">
              {count > 0 ? `${count} ${count === 1 ? "file" : "files"}` : "Empty Gallery"}
            </span>
          </div>
        )}

        {/* Top-Right Glass Badge: Photo Count */}
        <div className="absolute top-2.5 right-2.5 widget-badge-glass flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium shadow-lg">
          <Images className="h-3 w-3 text-zinc-300" />
          <span>{count}</span>
        </div>

        {/* Overlapping Thumbnails Stack (Bottom Left of Hero) */}
        {subImages.length > 0 && (
          <div className="absolute bottom-2.5 left-2.5 flex items-center">
            {subImages.map((img, i) => {
              const thumbnail = albumThumbnailUrl(img);
              return (
                <div
                  key={img.id}
                  style={{ zIndex: subImages.length - i }}
                  className={`relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-widget-bg bg-widget-surface shadow-md transition-transform group-hover:scale-105 ${
                    i > 0 ? "-ml-2.5" : ""
                  }`}
                >
                  {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-[#8ab4f8]" />
                  )}
                </div>
              );
            })}

            {extraCount > 0 && (
              <div
                style={{ zIndex: 0 }}
                className="-ml-2.5 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-widget-bg bg-widget-surface px-1.5 text-[10px] font-bold text-zinc-300 shadow-md backdrop-blur-md"
              >
                +{extraCount}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Info & Action Bar */}
      <div className="relative z-10 flex items-center justify-between gap-3 px-1 pt-2.5 pb-0.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold text-widget-text-primary group-hover:text-white transition-colors">
            {name}
          </h3>
          <p className="text-[11px] font-medium text-widget-text-secondary">
            {count} {count === 1 ? "file" : "files"}
          </p>
        </div>

        <Link
          href={slug ? `/workspace/${slug}/albums/${albumId}` : "#"}
          title="Open gallery"
          className="nodrag"
        >
          <Button type="button" variant="default" size="icon-xs" className="cursor-pointer">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}


