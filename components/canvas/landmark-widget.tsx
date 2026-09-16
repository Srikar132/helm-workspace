"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, House, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useCanvasActions } from "@/components/canvas/canvas-actions-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createLandmarkAction,
  getLandmark,
  renameLandmarkAction,
  setDefaultLandmarkAction,
  setLandmarkColorAction,
  type Landmark,
} from "@/lib/actions/landmarks";
import { LANDMARK_COLORS } from "@/lib/constants";
import { unwrapAction } from "@/lib/query-utils";

interface LandmarkWidgetProps {
  id: string;
  canWrite: boolean;
  /** Server-prefetched snapshot — seeds the pin's query so first paint needs
   *  no round-trip (same precedent as gallery/project-doc initial data). */
  initialLandmark?: Landmark;
  landmarkId?: string;
}

export function LandmarkWidget({ id, canWrite, initialLandmark, landmarkId }: LandmarkWidgetProps) {
  if (!landmarkId) {
    return <DraftLandmarkForm id={id} />;
  }
  return <LandmarkPin widgetId={id} canWrite={canWrite} landmarkId={landmarkId} initialLandmark={initialLandmark} />;
}

/** Footprint a SAVED pin occupies on the canvas — the draft form starts at the
 *  registry's roomier size and shrinks to this once the landmark exists. */
export const LANDMARK_PIN_SIZE = { width: 190, height: 220 };

/** Creation form — name + one of the predefined pin colours. Saving links the
 *  widget to its landmarks row via widgetData.landmarkId, then shrinks the
 *  widget down to pin size. Paints its own card (landmarks are chrome-less in
 *  widget-node), so this is the only phase with a background. */
function DraftLandmarkForm({ id }: { id: string }) {
  const { updateWidgetData, deleteWidget, resizeWidget } = useCanvasActions();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LANDMARK_COLORS[1].value);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => unwrapAction(createLandmarkAction({ name: name.trim(), color })),
    onSuccess: (landmark) => {
      // The toolbar's search list caches aggressively (5-min staleTime) —
      // without this the new pin stays invisible there until reload.
      void queryClient.invalidateQueries({ queryKey: ["landmarks"] });
      updateWidgetData(id, { landmarkId: landmark.id });
      resizeWidget(id, LANDMARK_PIN_SIZE);
    },
    onError: (err) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Give the landmark a name.");
      return;
    }
    createMutation.mutate();
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] border border-white/[0.1] bg-gradient-to-b from-[#1a1c21] to-[#0f1013] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.7)]">
      {/* Pin preview header — glow tinted by the selected colour */}
      <div className="relative flex flex-col items-center gap-2.5 px-6 pb-4 pt-7">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 transition-colors duration-300"
          style={{ background: `radial-gradient(140px 90px at 50% 10%, ${color}38, transparent)` }}
        />
        <div className="relative transition-transform duration-300 hover:-translate-y-1">
          <MapPin color={color} className="h-16 w-16 drop-shadow-[0_8px_12px_rgba(0,0,0,0.6)]" />
        </div>
        <div className="relative text-center">
          <h3 className="text-[14px] font-semibold tracking-tight text-[#e8eaed]">Drop a pin</h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-[#9aa0a6]">
            Mark this spot so anyone can jump straight back here
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4 px-5">
        {error && (
          <div className="flex items-center gap-1.5 rounded-xl border border-[#f28b82]/20 bg-[#f28b82]/10 px-3 py-2 text-[11.5px] text-[#f28b82]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`landmark-name-${id}`} className="text-[10.5px] font-semibold uppercase tracking-wider text-[#9aa0a6]">
            Name
          </label>
          <Input
            id={`landmark-name-${id}`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home"
            autoFocus
            maxLength={80}
            className="nodrag rounded-xl border-white/10 bg-white/[0.04] px-3 py-2 text-[12.5px] text-[#e8eaed] placeholder:text-[#5f6368] focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:border-white/30"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#9aa0a6]">Colour</span>
          <div className="grid grid-cols-8 gap-1.5">
            {LANDMARK_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={`Colour: ${c.label}`}
                onClick={() => setColor(c.value)}
                className={`nodrag flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-all ${
                  color === c.value
                    ? "scale-110 ring-2 ring-white/80 ring-offset-2 ring-offset-[#14161a]"
                    : "opacity-70 hover:scale-105 hover:opacity-100"
                }`}
                style={{ backgroundColor: c.value }}
              >
                {color === c.value && <Check className="h-3 w-3 text-white drop-shadow" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-end gap-2 pb-5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => deleteWidget(id)}
            className="text-widget-text-secondary hover:text-widget-text-primary"
          >
            Cancel
          </Button>
          <Button type="submit" variant="default" size="sm" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Drop Pin"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The saved landmark — a Maps-style pin standing at this canvas position.
 *  Right-click for everything: rename (recomputes slug), recolour, make it
 *  HOME, delete. The react-query cache is written through on every mutation so
 *  two pins referencing the same landmark stay in sync without a reload. */
function LandmarkPin({
  widgetId,
  canWrite,
  landmarkId,
  initialLandmark,
}: {
  widgetId: string;
  canWrite: boolean;
  landmarkId: string;
  initialLandmark?: Landmark;
}) {
  const { deleteWidget } = useCanvasActions();
  const queryClient = useQueryClient();

  const { data: landmark } = useQuery({
    queryKey: ["landmark", landmarkId],
    queryFn: () => getLandmark(landmarkId),
    initialData: initialLandmark ?? undefined,
  });

  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const applyUpdate = (updated: Landmark) => {
    // The toolbar's search list reads the same record — keep it honest.
    void queryClient.invalidateQueries({ queryKey: ["landmarks"] });
    return queryClient.setQueryData(["landmark", updated.id], updated);
  };

  const renameMutation = useMutation({
    mutationFn: (name: string) => unwrapAction(renameLandmarkAction({ id: landmarkId, name })),
    onSuccess: applyUpdate,
    onError: (err) => setError(err.message),
  });

  const colorMutation = useMutation({
    mutationFn: (color: string) => unwrapAction(setLandmarkColorAction({ id: landmarkId, color })),
    onSuccess: applyUpdate,
    onError: (err) => console.error("Failed to update colour:", err),
  });

  const defaultMutation = useMutation({
    mutationFn: () => unwrapAction(setDefaultLandmarkAction({ id: landmarkId })),
    onSuccess: applyUpdate,
    onError: (err) => console.error("Failed to set default:", err),
  });

  if (!landmark) return null;

  function handleRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!draftName.trim()) {
      setError("Give the landmark a name.");
      return;
    }
    renameMutation.mutate(draftName.trim());
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full w-full">
        <div className="group relative flex h-full w-full cursor-pointer select-none flex-col items-center justify-center gap-2 overflow-visible">
          <div className="relative transition-transform duration-200 group-hover:-translate-y-1 group-hover:scale-105">
            {/* HOME badge — pinned to the marker's shoulder */}
            {landmark.default && (
              <span
                title="Opens here by default"
                className="absolute -top-1.5 -right-3 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 shadow-lg ring-2 ring-[#1e1f20]"
              >
                <House className="h-3 w-3 text-black" strokeWidth={2.5} />
              </span>
            )}
            <MapPin color={landmark.color} className="h-16 w-16 drop-shadow-[0_6px_8px_rgba(0,0,0,0.55)] active:scale-95" />
          </div>
          <span className="max-w-full truncate rounded-full border border-white/10 bg-[#121316]/90 px-2.5 py-1 text-[11.5px] font-medium text-[#e8eaed] shadow-lg backdrop-blur-md">
            {landmark.name}
          </span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          disabled={!canWrite}
          onSelect={() => {
            setDraftName(landmark.name);
            setError(null);
            setRenameOpen(true);
          }}
        >
          <Pencil className="h-3.5 w-3.5" /> Rename
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!canWrite}>
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
              style={{ backgroundColor: landmark.color }}
            />
            Change colour
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {LANDMARK_COLORS.map((c) => (
              <ContextMenuItem
                key={c.value}
                disabled={!canWrite || colorMutation.isPending}
                onSelect={() => colorMutation.mutate(c.value)}
              >
                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: c.value }} />
                {c.label}
                {landmark.color === c.value && <Check className="ml-auto h-3.5 w-3.5" />}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {!landmark.default && (
          <ContextMenuItem disabled={!canWrite || defaultMutation.isPending} onSelect={() => defaultMutation.mutate()}>
            <House className="h-3.5 w-3.5" /> Set as HOME
          </ContextMenuItem>
        )}

        {canWrite && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => {
                deleteWidget(widgetId);
                void queryClient.invalidateQueries({ queryKey: ["landmarks"] });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete landmark
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename landmark</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRename} className="flex flex-col gap-3">
            {error && (
              <div className="flex items-center gap-1.5 rounded-xl border border-[#f28b82]/20 bg-[#f28b82]/10 px-3 py-2 text-[11.5px] text-[#f28b82]">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="Landmark name"
            />
            <p className="text-[11px] text-[#9aa0a6]">
              Slug becomes{" "}
              <code className="rounded bg-white/10 px-1 py-0.5">{slugPreview(draftName)}</code>
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="default" size="sm" disabled={renameMutation.isPending}>
                {renameMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ContextMenu>
  );
}

function slugPreview(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "landmark";
}

/** Classic Maps teardrop marker — filled with the landmark's palette colour,
 *  gloss highlight for depth, dark hub + white core at the point of interest. */
function MapPin({ color, className }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 384 512" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <path
        d="M172.268 501.67C26.97 291.031 0 269.413 0 192 0 85.961 85.961 0 192 0s192 85.961 192 192c0 77.413-26.97 99.031-172.268 309.67-9.535 13.774-29.93 13.773-39.464 0z"
        fill={color}
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="8"
      />
      <ellipse cx="132" cy="118" rx="58" ry="36" fill="white" opacity="0.18" transform="rotate(-22 132 118)" />
      <circle cx="192" cy="192" r="72" fill="#121316" opacity="0.9" />
      <circle cx="192" cy="192" r="46" fill="white" opacity="0.95" />
    </svg>
  );
}
