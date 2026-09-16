"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckSquare, FileText, Folder, FolderPlus, Menu, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DocumentViewerOverlay } from "@/components/canvas/document-viewer-overlay";
import { BulkActionBar } from "@/components/files/bulk-action-bar";
import { FileGrid, downloadFile } from "@/components/files/file-grid";
import { UploadDropzone } from "@/components/files/upload-dropzone";
import { useFileUpload } from "@/components/files/use-file-upload";
import {
  createFileFolder,
  deleteFileFolder,
  getLibraryFiles,
  renameFileFolder,
  renameFileLibraryAction,
  type FileFolderRow,
  type FileLibraryRow,
  type LibraryFileRow,
  type LibraryFilesPage,
} from "@/lib/actions/files";
import { unwrapAction } from "@/lib/query-utils";

interface LibraryViewProps {
  slug: string;
  library: FileLibraryRow;
  initialFolders: FileFolderRow[];
  initialFilesPage: LibraryFilesPage;
  canWrite: boolean;
}

/** "all" = every document regardless of folder; "ungrouped" = no folder;
 *  anything else is a real folder id. */
type Filter = "all" | "ungrouped" | string;

function filterToFolderId(filter: Filter): string | null | undefined {
  if (filter === "all") return undefined;
  if (filter === "ungrouped") return null;
  return filter;
}

export function LibraryView({ slug, library, initialFolders, initialFilesPage, canWrite }: LibraryViewProps) {
  const [name, setName] = useState(library.name);
  const [folders, setFolders] = useState<FileFolderRow[]>(initialFolders);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [viewing, setViewing] = useState<LibraryFileRow | null>(null);

  const queryClient = useQueryClient();

  // Cached per (library, filter) — switching folders and back doesn't refetch
  // a folder already loaded this session. "all" seeds from the server's first
  // page; any other filter fetches on first visit, then caches the same way.
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["libraryFiles", library.id, filter],
    queryFn: ({ pageParam }) => getLibraryFiles(library.id, { folderId: filterToFolderId(filter), cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialData: filter === "all" ? { pages: [initialFilesPage], pageParams: [null] } : undefined,
    staleTime: 30_000,
  });

  const files = data?.pages.flatMap((p) => p.files) ?? [];

  /** The canvas Files card caches this library's preview (name, count, latest
   *  few) under its own key, and the QueryClient outlives route changes — so
   *  without this, editing here and going back to the canvas shows a stale
   *  card. Invalidating the files query with just [library.id] matches every
   *  filter variant, since a move or delete affects folders other than the one
   *  currently open. */
  function invalidateLibrary() {
    void queryClient.invalidateQueries({ queryKey: ["libraryFiles", library.id] });
    void queryClient.invalidateQueries({ queryKey: ["fileLibraryPreview", library.id] });
  }

  const renameLibraryMutation = useMutation({
    mutationFn: (value: string) => unwrapAction(renameFileLibraryAction(library.id, value)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fileLibraryPreview", library.id] }),
    onError: (err) => console.error("Failed to rename library:", err),
  });

  const nameSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleNameChange(value: string) {
    setName(value);
    if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    nameSaveTimer.current = setTimeout(() => renameLibraryMutation.mutate(value), 600);
  }

  const createFolderMutation = useMutation({
    mutationFn: (folderName: string) => unwrapAction(createFileFolder(library.id, folderName)),
    onSuccess: (res, folderName) => {
      if (res.id) {
        setFolders((prev) => [
          ...prev,
          { id: res.id!, libraryId: library.id, name: folderName, position: prev.length, createdAt: new Date() },
        ]);
        setNewFolderName("");
      }
    },
    onError: (err) => console.error("Failed to create folder:", err),
  });

  function handleAddFolder(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    createFolderMutation.mutate(trimmed);
  }

  const renameFolderMutation = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      unwrapAction(renameFileFolder(input.id, library.id, input.name)),
    onError: (err) => console.error("Failed to rename folder:", err),
  });

  function handleRenameFolder(id: string, newName: string) {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: newName } : f)));
    renameFolderMutation.mutate({ id, name: newName });
  }

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => unwrapAction(deleteFileFolder(id, library.id)),
    onSuccess: invalidateLibrary,
    onError: (err) => console.error("Failed to delete folder:", err),
  });

  function handleDeleteFolder(id: string, folderName: string) {
    if (!window.confirm(`Delete "${folderName}"? Its documents become ungrouped — nothing is deleted.`)) return;
    setFolders((prev) => prev.filter((f) => f.id !== id));
    if (filter === id) setFilter("all");
    deleteFolderMutation.mutate(id);
  }

  const { uploadFiles, pending, dismissPending } = useFileUpload(
    library.id,
    filterToFolderId(filter) ?? null,
    invalidateLibrary,
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!canWrite) return;
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFilter(next: Filter) {
    setFilter(next);
    setSelectedIds(new Set());
    setSidebarOpen(false);
  }

  /** A PDF is read in the viewer overlay; a Word file has nothing a browser
   *  can render, so opening it means downloading it. */
  function openFile(file: LibraryFileRow) {
    if (file.kind === "pdf") setViewing(file);
    else downloadFile(file);
  }

  return (
    <div className="flex h-screen flex-col bg-card text-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-popover px-3 sm:gap-3 sm:px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen((v) => !v)}
          title="Folders"
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
          placeholder="Untitled library"
          className="min-w-0 flex-1 truncate -mx-1.5 rounded-lg bg-transparent px-1.5 text-[13.5px] font-semibold text-foreground outline-none transition-colors enabled:hover:bg-white/[0.04] focus:bg-white/[0.06] disabled:cursor-default sm:flex-none sm:text-[14px]"
        />
        <span className="flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-muted-foreground">
          <FileText className="h-3 w-3" />
          {files.length}
        </span>

        {files.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setSelectionMode((v) => !v);
              setSelectedIds(new Set());
            }}
            title="Select documents"
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
            className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold shadow-[0_2px_8px_rgba(138,180,248,0.3)] transition-transform active:scale-95 sm:px-3.5"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Add documents</span>
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
          <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
            <SidebarRow
              icon={FileText}
              label="All documents"
              active={filter === "all"}
              onClick={() => selectFilter("all")}
            />
            <SidebarRow
              icon={Folder}
              label="Ungrouped"
              active={filter === "ungrouped"}
              onClick={() => selectFilter("ungrouped")}
            />
            <div className="mt-4 mb-1 px-2.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Folders
            </div>
            {folders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                active={filter === folder.id}
                canWrite={canWrite}
                onClick={() => selectFilter(folder.id)}
                onRename={(newName) => handleRenameFolder(folder.id, newName)}
                onDelete={() => handleDeleteFolder(folder.id, folder.name)}
              />
            ))}
          </div>
          {canWrite && (
            <form onSubmit={handleAddFolder} className="flex items-center gap-1.5 border-t border-white/[0.06] p-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                disabled={createFolderMutation.isPending || !newFolderName.trim()}
                title="Add folder"
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
          <FileGrid
            files={files}
            folders={folders}
            pendingUploads={pending}
            onDismissPending={dismissPending}
            selectedIds={selectedIds}
            selectionMode={selectionMode}
            canWrite={canWrite}
            isSwitching={isLoading}
            hasMore={!!hasNextPage}
            loadingMore={isFetchingNextPage}
            onLoadMore={() => void fetchNextPage()}
            onToggleSelect={toggleSelect}
            onOpen={openFile}
            onRefresh={invalidateLibrary}
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          files={files}
          folders={folders}
          onClear={() => setSelectedIds(new Set())}
          onDone={invalidateLibrary}
        />
      )}

      {viewing && (
        <DocumentViewerOverlay url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

function SidebarRow({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label}</span>
    </div>
  );
}

function FolderRow({
  folder,
  active,
  canWrite,
  onClick,
  onRename,
  onDelete,
}: {
  folder: FileFolderRow;
  active: boolean;
  canWrite: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(folder.name);

  if (editing) {
    return (
      <input
        type="text"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (value.trim() && value.trim() !== folder.name) onRename(value.trim());
          else setValue(folder.name);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(folder.name);
            setEditing(false);
          }
        }}
        className="mb-0.5 w-full rounded-lg border border-primary/40 bg-white/5 px-2.5 py-1.5 text-[13px] text-foreground outline-none"
      />
    );
  }

  return (
    <div
      onClick={onClick}
      onDoubleClick={() => canWrite && setEditing(true)}
      className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
      }`}
    >
      <Folder className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{folder.name}</span>
      {canWrite && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
