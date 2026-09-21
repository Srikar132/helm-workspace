"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, FileText, Images, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useCanvasActions } from "@/components/canvas/canvas-actions-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  createAlbumAction,
  deleteAlbumAction,
  getAlbumPreview,
  type AlbumImageRow,
  type AlbumPreview,
} from "@/lib/actions/albums";
import { unwrapAction } from "@/lib/query-utils";
import { albumStackThumbnailUrl } from "@/lib/album-file";

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
      <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 p-3">
        <Skeleton className="aspect-square w-full rounded-[20%]" />
        <Skeleton className="h-3 w-20 rounded-full" />
      </div>
    );
  }

  if (isError || !preview) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
        <div className="flex aspect-square w-full items-center justify-center rounded-[20%] bg-widget-surface/60">
          <AlertCircle className="h-5 w-5 text-[#f28b82] opacity-80" />
        </div>
        <span className="text-[11px] text-[#f28b82]">Couldn&apos;t load</span>
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

// The default "no photo yet" face for the front card — just the shaded
// two-tone mountain; the sun is drawn separately (see PhotoStackIcon) so it
// stays visible as a permanent corner badge even once a real photo fills
// this card.
function MountainGlyph() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
      <path d="M0 62 L24 40 L42 56 L58 38 L100 66 L100 100 L0 100 Z" fill="#8fc1ff" />
      <path d="M0 72 L30 50 L52 68 L100 46 L100 100 L0 100 Z" fill="#5b9bf0" />
    </svg>
  );
}

// Just the gradient card + shaded hill now — the three photo cards on top of
// it are real HTML (see StackCard below), not SVG shapes, since each one has
// to be able to host an actual <img>.
function StackBackdrop() {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="gallery-icon-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2f6fed" />
          <stop offset="100%" stopColor="#1447e6" />
        </linearGradient>
        <linearGradient id="gallery-icon-hill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8fc1ff" />
          <stop offset="100%" stopColor="#5b9bf0" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="20" fill="url(#gallery-icon-bg)" />
      <path
        d="M0 60 C10 56 18 50 30 47 C42 44 46 52 55 50 C66 47 68 36 80 33 C90 31 96 34 100 37 L100 100 L0 100 Z"
        fill="url(#gallery-icon-hill)"
      />
    </svg>
  );
}

// Back-to-front stack positions (percentages of the icon), each slightly
// bigger/less rotated than the one behind it — same layered layout as the
// reference, but every slot is a real card now instead of just the front
// one, so all three latest images actually show.
const STACK_SLOTS = [
  { left: "34%", top: "30%", size: "40%", rotate: "9deg", sun: false },
  { left: "26%", top: "22%", size: "42%", rotate: "4deg", sun: false },
  { left: "14%", top: "14%", size: "44%", rotate: "-7deg", sun: true },
] as const;

function StackCard({
  slot,
  image,
}: {
  slot: (typeof STACK_SLOTS)[number];
  image: AlbumImageRow | null;
}) {
  const thumb = image ? albumStackThumbnailUrl(image) : null;

  return (
    <div
      className={`absolute overflow-hidden rounded-[18%] shadow-md ${
        thumb ? "bg-[#eaf2ff]" : "border border-white/30 bg-white/15"
      }`}
      style={{ left: slot.left, top: slot.top, width: slot.size, height: slot.size, transform: `rotate(${slot.rotate})` }}
    >
      {thumb ? (
        <Image src={thumb} alt="" fill sizes="120px" loading="lazy" className="object-cover" />
      ) : image ? (
        <div className="flex h-full w-full items-center justify-center bg-[#eaf2ff]">
          <FileText className="h-4 w-4 text-[#5b8def]" />
        </div>
      ) : slot.sun ? (
        <MountainGlyph />
      ) : null}
      {/* Sun badge — only the front card gets one, always on top of
          whatever fills it (real photo or the empty-state glyph), so it
          stays a fixed part of the icon's identity. */}
      {slot.sun && <span className="absolute left-[10%] top-[10%] h-[18%] w-[18%] rounded-full bg-[#fbbf24] shadow-sm" />}
    </div>
  );
}

// Fixed square, independent of any source image's aspect ratio — this is
// what keeps the widget's footprint constant regardless of what's inside
// the album (the bug behind #19). Each card crops its photo via
// object-cover, so nothing stretches the icon to fit a portrait/landscape.
function PhotoStackIcon({ images }: { images: AlbumImageRow[] }) {
  // Oldest-first so the newest image lands in the front (topmost, largest) slot.
  const slotImages = [images[2] ?? null, images[1] ?? null, images[0] ?? null];
  // Stack depth follows the actual count: a 1-photo album is just the front
  // card, not a real photo propped in front of two empty ghost cards. The
  // only time every slot renders is the true empty state, where the two
  // "peeking" cards are what makes it read as an icon rather than a bare
  // square — front card's glyph/sun still needs that backdrop.
  const visible = images.length === 0 ? [0, 1, 2] : [0, 1, 2].filter((i) => slotImages[i] !== null);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-[20%] shadow-lg ring-1 ring-black/10">
      <StackBackdrop />
      {visible.map((i) => (
        <StackCard key={images[2 - i]?.id ?? `empty-${i}`} slot={STACK_SLOTS[i]} image={slotImages[i]} />
      ))}
    </div>
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
  const { name, images } = preview;
  const href = slug ? `/workspace/${slug}/albums/${albumId}` : undefined;

  // Only the icon is a link (and only it is `nodrag`) — the same split
  // BookmarkCard uses between its icon band and its title `<a>`, just
  // mirrored: here the icon opens the gallery and the name is what's left
  // to grab, so holding the name (or anywhere but the icon) still drags the
  // widget instead of racing against a click that navigates away.
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 p-3">
      {href ? (
        <Link href={href} title={`Open ${name}`} draggable={false} className="nodrag block w-full">
          <PhotoStackIcon images={images} />
        </Link>
      ) : (
        <PhotoStackIcon images={images} />
      )}
      <span className="max-w-30 truncate text-center text-[12.5px] font-medium text-widget-text-primary">{name}</span>
    </div>
  );
}


