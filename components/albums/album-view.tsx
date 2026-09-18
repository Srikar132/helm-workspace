"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckSquare, FilePlus2, FileText, Folder, FolderPlus, Images, Menu, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  createAlbumGroup,
  deleteAlbumGroup,
  getAlbumImages,
  renameAlbumAction,
  renameAlbumGroup,
  type AlbumGroupRow,
  type AlbumImageRow,
  type AlbumImagesPage,
  type AlbumRow,
} from "@/lib/actions/albums";
import { unwrapAction } from "@/lib/query-utils";
import { AlbumGrid, downloadItem } from "@/components/albums/album-grid";
import { UploadDropzone } from "@/components/albums/upload-dropzone";
import { useAlbumUpload } from "@/components/albums/use-album-upload";
import { useAlbumImageMutations } from "@/components/albums/use-album-image-mutations";
import { Lightbox } from "@/components/albums/lightbox";
import { DocumentViewerOverlay } from "@/components/albums/document-viewer-overlay";
import { BulkActionBar } from "@/components/albums/bulk-action-bar";
import { MoveDuplicateDialog } from "@/components/albums/move-duplicate-dialog";
import { albumThumbnailUrl } from "@/lib/album-file";

/** "ungrouped" (the sidebar's built-in row) is a valid drop target that maps
 *  to a real `groupId: null`, distinct from dnd-kit's droppable id string. */
const UNGROUPED_DROP_ID = "ungrouped";

interface PendingDrop {
  imageIds: string[];
  groupId: string | null;
  groupName: string;
}

interface AlbumViewProps {
  slug: string;
  album: AlbumRow;
  initialGroups: AlbumGroupRow[];
  initialImagesPage: AlbumImagesPage;
  canWrite: boolean;
}

/** "all" = every file regardless of group; "ungrouped" = no group; anything
 *  else is a real group id. */
type Filter = "all" | "ungrouped" | string;

function filterToGroupId(filter: Filter): string | null | undefined {
  if (filter === "all") return undefined;
  if (filter === "ungrouped") return null;
  return filter;
}

export function AlbumView({ slug, album, initialGroups, initialImagesPage, canWrite }: AlbumViewProps) {
  const [name, setName] = useState(album.name);
  const [groups, setGroups] = useState<AlbumGroupRow[]>(initialGroups);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [viewingDocument, setViewingDocument] = useState<AlbumImageRow | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [draggingImage, setDraggingImage] = useState<AlbumImageRow | null>(null);

  const queryClient = useQueryClient();

  // Cached per (album, filter) — switching group tabs and back no longer
  // refetches a tab that's already been loaded this session. The "all"
  // filter seeds from the server-prefetched first page; any other filter's
  // first visit fetches for real, then is cached same as "all" from then on.
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["albumImages", album.id, filter],
    queryFn: ({ pageParam }) => getAlbumImages(album.id, { groupId: filterToGroupId(filter), cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialData: filter === "all" ? { pages: [initialImagesPage], pageParams: [null] } : undefined,
    staleTime: 30_000,
  });

  const items = data?.pages.flatMap((p) => p.images) ?? [];
  // The lightbox pages through photos only — a PDF has its own viewer and a
  // Word file has none at all, so indexes are into this list, not `items`.
  const photos = items.filter((item) => item.kind === "image");

  /** A photo opens the lightbox, a PDF the document viewer; a Word file has
   *  nothing in a browser that can render it, so it downloads. */
  function openItem(item: AlbumImageRow) {
    if (item.kind === "image") {
      const index = photos.findIndex((photo) => photo.id === item.id);
      if (index >= 0) setLightboxIndex(index);
      return;
    }
    if (item.kind === "pdf") {
      setViewingDocument(item);
      return;
    }
    downloadItem(item);
  }

  // The canvas gallery card caches this album's preview (count + latest 3)
  // under this same key — now that the QueryClient is shared across route
  // navigation (see app/providers.tsx) instead of being torn down on every
  // nav, a long-lived cache entry would otherwise show a stale count/thumbs
  // after editing here and going back to the canvas. Invalidating the
  // images query with just [albumId] (no filter) matches every filter
  // variant at once — a move/delete can affect more than the tab you're
  // currently looking at (e.g. moving a photo out of the group you're in).
  function invalidateAlbum() {
    void queryClient.invalidateQueries({ queryKey: ["albumImages", album.id] });
    void queryClient.invalidateQueries({ queryKey: ["albumPreview", album.id] });
  }

  const renameAlbumMutation = useMutation({
    mutationFn: (value: string) => unwrapAction(renameAlbumAction(album.id, value)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["albumPreview", album.id] }),
    onError: (err) => console.error("Failed to rename album:", err),
  });

  const nameSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleNameChange(value: string) {
    setName(value);
    if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    nameSaveTimer.current = setTimeout(() => renameAlbumMutation.mutate(value), 600);
  }

  const createGroupMutation = useMutation({
    mutationFn: (groupName: string) => unwrapAction(createAlbumGroup(album.id, groupName)),
    onSuccess: (res, groupName) => {
      if (res.id) {
        setGroups((prev) => [...prev, { id: res.id!, albumId: album.id, name: groupName, position: prev.length, createdAt: new Date() }]);
        setNewGroupName("");
      }
    },
    onError: (err) => console.error("Failed to create group:", err),
  });

  function handleAddGroup(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newGroupName.trim();
    if (!trimmed) return;
    createGroupMutation.mutate(trimmed);
  }

  const renameGroupMutation = useMutation({
    mutationFn: (input: { id: string; name: string }) => unwrapAction(renameAlbumGroup(input.id, album.id, input.name)),
    onError: (err) => console.error("Failed to rename group:", err),
  });

  function handleRenameGroup(id: string, newName: string) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name: newName } : g)));
    renameGroupMutation.mutate({ id, name: newName });
  }

  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => unwrapAction(deleteAlbumGroup(id, album.id)),
    onSuccess: invalidateAlbum,
    onError: (err) => console.error("Failed to delete group:", err),
  });

  function handleDeleteGroup(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? Its files become ungrouped — nothing is deleted.`)) return;
    setGroups((prev) => prev.filter((g) => g.id !== id));
    if (filter === id) setFilter("all");
    deleteGroupMutation.mutate(id);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleUploaded() {
    invalidateAlbum();
  }

  function selectFilter(next: Filter) {
    setFilter(next);
    setSelectedIds(new Set());
    setSidebarOpen(false);
  }

  function toggleSelectionMode() {
    setSelectionMode((v) => !v);
    setSelectedIds(new Set());
  }

  const { uploadFiles, pending, dismissPending } = useAlbumUpload(album.id, filterToGroupId(filter) ?? null, handleUploaded);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!canWrite) return;
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  }

  const { move, duplicate, bulkMove } = useAlbumImageMutations(invalidateAlbum);

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );
  const noSensors = useSensors();

  function handleDragStart(event: DragStartEvent) {
    const imageId = event.active.data.current?.imageId as string | undefined;
    setDraggingImage(items.find((item) => item.id === imageId) ?? null);
    // The group sidebar (the only drop targets) is hidden behind a toggle on
    // mobile — without this, a drag on a narrow screen has nowhere to land.
    setSidebarOpen(true);
  }

  function handleDragOver(event: { over: { id: string | number } | null }) {
    setDropTargetId(event.over ? String(event.over.id) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDropTargetId(null);
    setDraggingImage(null);
    const { active, over } = event;
    if (!over) return;

    const imageId = active.data.current?.imageId as string | undefined;
    const sourceGroupId = (active.data.current?.groupId ?? null) as string | null;
    if (!imageId) return;

    const targetId = String(over.id);
    const targetGroupId = targetId === UNGROUPED_DROP_ID ? null : targetId;
    if (targetGroupId === sourceGroupId) return;

    const isMultiDrag = selectedIds.has(imageId) && selectedIds.size > 1;
    const imageIds = isMultiDrag ? [...selectedIds] : [imageId];
    const groupName = targetGroupId ? groups.find((g) => g.id === targetGroupId)?.name ?? "group" : "Ungrouped";

    setPendingDrop({ imageIds, groupId: targetGroupId, groupName });
  }

  function handleConfirmMove() {
    if (!pendingDrop) return;
    if (pendingDrop.imageIds.length > 1) {
      bulkMove.mutate({ ids: pendingDrop.imageIds, groupId: pendingDrop.groupId });
      setSelectedIds(new Set());
    } else {
      move.mutate({ id: pendingDrop.imageIds[0], groupId: pendingDrop.groupId });
    }
    setPendingDrop(null);
  }

  function handleConfirmDuplicate() {
    if (!pendingDrop) return;
    duplicate.mutate({ id: pendingDrop.imageIds[0], targetGroupId: pendingDrop.groupId });
    setPendingDrop(null);
  }

  return (
    <DndContext
      id="album-view"
      sensors={canWrite ? dragSensors : noSensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
    <div className="flex h-screen flex-col bg-card text-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-popover px-3 sm:gap-3 sm:px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen((v) => !v)}
          title="Groups"
          className="rounded-full text-muted-foreground md:hidden"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <Link
          href={`/workspace/${slug}`}
          title="Back to canvas"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={!canWrite}
          placeholder="Untitled album"
          className="min-w-0 flex-1 truncate rounded-lg bg-transparent px-1.5 -mx-1.5 text-[13.5px] font-semibold text-foreground outline-none transition-colors disabled:cursor-default enabled:hover:bg-white/[0.04] focus:bg-white/[0.06] sm:flex-none sm:text-[14px]"
        />
        <span className="flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-muted-foreground">
          <Images className="h-3 w-3" />
          {items.length}
        </span>

        {items.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleSelectionMode}
            title="Select files"
            className={
              selectionMode
                ? "rounded-full bg-primary/15 text-primary hover:bg-primary/15"
                : "rounded-full text-muted-foreground"
            }
          >
            <CheckSquare className="h-4 w-4" />
          </Button>
        )}

        {canWrite && (
          <UploadDropzone
            uploadFiles={uploadFiles}
            className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold shadow-[0_2px_8px_rgba(138,180,248,0.3)] transition-transform active:scale-95 cursor-pointer sm:px-3.5"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Add files</span>
          </UploadDropzone>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <div className="fixed inset-0 top-14 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <div
          className={`fixed inset-y-14 left-0 z-30 flex w-56 flex-col border-r border-white/[0.06] bg-popover transition-transform duration-200 md:static md:inset-y-auto md:z-auto md:translate-x-0 md:transition-none ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
            <SidebarRow
              icon={Images}
              label="All files"
              active={filter === "all"}
              onClick={() => selectFilter("all")}
            />
            <SidebarRow
              icon={Folder}
              label="Ungrouped"
              active={filter === "ungrouped"}
              onClick={() => selectFilter("ungrouped")}
              droppableId={canWrite ? UNGROUPED_DROP_ID : undefined}
              isDropTarget={dropTargetId === UNGROUPED_DROP_ID}
            />
            <div className="mt-4 mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Groups
            </div>
            {groups.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                active={filter === g.id}
                canWrite={canWrite}
                onClick={() => selectFilter(g.id)}
                onRename={(newName) => handleRenameGroup(g.id, newName)}
                onDelete={() => handleDeleteGroup(g.id, g.name)}
                isDropTarget={dropTargetId === g.id}
              />
            ))}
          </div>
          {canWrite && (
            <form onSubmit={handleAddGroup} className="flex items-center gap-1.5 border-t border-white/[0.06] p-2">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="New group"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                disabled={createGroupMutation.isPending || !newGroupName.trim()}
                title="Add group"
                className="rounded-full text-muted-foreground disabled:opacity-40"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            </form>
          )}
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto bg-card p-4 sm:p-6"
          onDragOver={(e) => canWrite && e.preventDefault()}
          onDrop={handleDrop}
        >
          <AlbumGrid
            items={items}
            pendingUploads={pending}
            onDismissPending={dismissPending}
            selectedIds={selectedIds}
            canWrite={canWrite}
            onToggleSelect={toggleSelect}
            onOpen={openItem}
            hasMore={!!hasNextPage}
            loadingMore={isFetchingNextPage}
            onLoadMore={() => void fetchNextPage()}
            groups={groups}
            onRefresh={invalidateAlbum}
            isSwitching={isLoading}
            selectionMode={selectionMode}
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          items={items}
          groups={groups}
          onClear={() => setSelectedIds(new Set())}
          onDone={invalidateAlbum}
        />
      )}

      {lightboxIndex !== null && (
        <Lightbox
          images={photos}
          index={lightboxIndex}
          groups={groups}
          canWrite={canWrite}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onChanged={invalidateAlbum}
        />
      )}

      {viewingDocument && (
        <DocumentViewerOverlay
          url={viewingDocument.url}
          name={viewingDocument.name ?? "Document"}
          onClose={() => setViewingDocument(null)}
        />
      )}

      {pendingDrop && (
        <MoveDuplicateDialog
          imageCount={pendingDrop.imageIds.length}
          groupName={pendingDrop.groupName}
          onMove={handleConfirmMove}
          onDuplicate={handleConfirmDuplicate}
          onOpenChange={(open) => {
            if (!open) setPendingDrop(null);
          }}
        />
      )}
    </div>

    {typeof document !== "undefined" &&
      createPortal(
        <DragOverlay dropAnimation={null}>
          {draggingImage ? (
            <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border-2 border-primary bg-card shadow-2xl">
              {albumThumbnailUrl(draggingImage) ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Cloudinary domain
                <img src={albumThumbnailUrl(draggingImage)!} alt="" className="h-full w-full object-cover" />
              ) : (
                <FileText className="h-7 w-7 text-[#8ab4f8]" />
              )}
              {selectedIds.has(draggingImage.id) && selectedIds.size > 1 && (
                <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                  {selectedIds.size}
                </span>
              )}
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

function SidebarRow({
  icon: Icon,
  label,
  active,
  onClick,
  droppableId,
  isDropTarget,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  droppableId?: string;
  isDropTarget?: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: droppableId ?? "", disabled: !droppableId });

  return (
    <div
      ref={droppableId ? setNodeRef : undefined}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
        isDropTarget
          ? "bg-primary/20 ring-2 ring-primary/60"
          : active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label}</span>
    </div>
  );
}

function GroupRow({
  group,
  active,
  canWrite,
  onClick,
  onRename,
  onDelete,
  isDropTarget,
}: {
  group: AlbumGroupRow;
  active: boolean;
  canWrite: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  isDropTarget?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(group.name);
  const { setNodeRef } = useDroppable({ id: group.id, disabled: !canWrite });

  if (editing) {
    return (
      <input
        type="text"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (value.trim() && value.trim() !== group.name) onRename(value.trim());
          else setValue(group.name);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(group.name);
            setEditing(false);
          }
        }}
        className="mb-0.5 w-full rounded-lg border border-primary/40 bg-white/5 px-2.5 py-1.5 text-[13px] text-foreground outline-none"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      onDoubleClick={() => canWrite && setEditing(true)}
      className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
        isDropTarget
          ? "bg-primary/20 ring-2 ring-primary/60"
          : active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
      }`}
    >
      <Folder className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{group.name}</span>
      {canWrite && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
