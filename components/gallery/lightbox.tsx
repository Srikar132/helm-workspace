"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Copy, Download, FolderInput, ImageDown, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { copyImage, copyLink, downloadItem } from "@/components/gallery/image-actions";
import { useGalleryImageMutations } from "@/components/gallery/use-gallery-image-mutations";
import { useModalDialog } from "@/components/gallery/use-modal-dialog";
import { ZoomableImage } from "@/components/gallery/zoomable-image";
import type { GalleryGroupRow, GalleryImageRow } from "@/lib/actions/galleries";

interface LightboxProps {
  images: GalleryImageRow[];
  index: number;
  groups: GalleryGroupRow[];
  canWrite: boolean;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onChanged: () => void;
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true']");
}

export function Lightbox({ images, index, groups, canWrite, onClose, onIndexChange, onChanged }: LightboxProps) {
  const image = images[index];
  const { remove } = useGalleryImageMutations(onChanged);
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Zoomed: arrow keys pan the image (handled by the stage), so they must not
  // also change photo.
  const [zoomed, setZoomed] = useState(false);

  useModalDialog({ dialogRef, closeRef, onClose });

  useEffect(() => {
    function handleArrows(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      if (!zoomed && e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (!zoomed && e.key === "ArrowRight" && index < images.length - 1) onIndexChange(index + 1);
    }
    document.addEventListener("keydown", handleArrows);
    return () => document.removeEventListener("keydown", handleArrows);
  }, [index, images.length, zoomed, onIndexChange]);

  if (!image) return null;

  function handleDelete() {
    if (!window.confirm("Delete this photo? This can't be undone.")) return;
    remove.mutate(image.id, { onSuccess: onClose });
  }

  return (
    <AnimatePresence>
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={image.name || `Photo ${index + 1} of ${images.length}`}
        initial={{ opacity: reduceMotion ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex flex-col bg-black/92"
      >
        <div className="flex items-center justify-between border-b border-white/6 p-3 sm:p-4">
          <span className="truncate text-[12.5px] text-white/70">{image.name || `${index + 1} / ${images.length}`}</span>
          <span className="sr-only" aria-live="polite">
            Photo {index + 1} of {images.length}
          </span>
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
          <ZoomableImage key={image.id} image={image} onBackdropTap={onClose} onZoomedChange={setZoomed} />

          {index > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label="Previous photo"
              onClick={() => onIndexChange(index - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 sm:left-4"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}

          {index < images.length - 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label="Next photo"
              onClick={() => onIndexChange(index + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 sm:right-4"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          )}
        </div>

        <LightboxActionBar
          key={image.id}
          image={image}
          groups={groups}
          canWrite={canWrite}
          onDelete={handleDelete}
          onChanged={onChanged}
        />
      </motion.div>
    </AnimatePresence>
  );
}

/** Keyed by image.id in the parent — remounting on image change resets
 *  `renaming`/`name` for free, instead of syncing them via an effect.
 *
 *  Copy and Download only READ the image, so they are shown to everyone; the
 *  actions that change the gallery stay behind `canWrite` (and the server
 *  checks the role again on every one of them). */
function LightboxActionBar({
  image,
  groups,
  canWrite,
  onDelete,
  onChanged,
}: {
  image: GalleryImageRow;
  groups: GalleryGroupRow[];
  canWrite: boolean;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(image.name ?? "");
  const { rename, duplicate, move } = useGalleryImageMutations(onChanged);

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 p-3 sm:p-4">
      {renaming ? (
        <input
          type="text"
          value={name}
          autoFocus
          aria-label="Photo name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setRenaming(false);
            rename.mutate({ id: image.id, name });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
          className="w-48 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[12.5px] text-white outline-none"
        />
      ) : (
        <>
          <LightboxAction icon={ImageDown} label="Copy image" onClick={() => void copyImage(image)} />
          <LightboxAction icon={Copy} label="Copy link" onClick={() => void copyLink(image)} />
          <LightboxAction icon={Download} label="Download" onClick={() => downloadItem(image)} />
          {canWrite && (
            <>
              <LightboxAction icon={Pencil} label="Rename" onClick={() => setRenaming(true)} />
              <LightboxAction icon={FolderInput} label="Duplicate" onClick={() => duplicate.mutate({ id: image.id })} />
              {(groups.filter((g) => g.id !== image.groupId).length > 0 || image.groupId) && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Move to group"
                    className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-white hover:bg-white/20"
                  >
                    <FolderInput className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Move</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                    {groups
                      .filter((g) => g.id !== image.groupId)
                      .map((g) => (
                        <DropdownMenuItem key={g.id} onClick={() => move.mutate({ id: image.id, groupId: g.id })}>
                          {g.name}
                        </DropdownMenuItem>
                      ))}
                    {image.groupId && (
                      <DropdownMenuItem onClick={() => move.mutate({ id: image.id, groupId: null })}>
                        Ungrouped
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <LightboxAction icon={Trash2} label="Delete" onClick={onDelete} destructive />
            </>
          )}
        </>
      )}
    </div>
  );
}

function LightboxAction({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={destructive ? "destructive" : "ghost"}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`h-auto min-h-9 min-w-9 justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] ${
        destructive ? "" : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
