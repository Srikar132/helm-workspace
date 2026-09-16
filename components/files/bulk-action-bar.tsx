"use client";

import { motion } from "framer-motion";
import { Download, FolderInput, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadFile } from "@/components/files/file-grid";
import { useFileMutations } from "@/components/files/use-file-mutations";
import type { FileFolderRow, LibraryFileRow } from "@/lib/actions/files";

interface BulkActionBarProps {
  selectedIds: Set<string>;
  files: LibraryFileRow[];
  folders: FileFolderRow[];
  onClear: () => void;
  onDone: () => void;
}

export function BulkActionBar({ selectedIds, files, folders, onClear, onDone }: BulkActionBarProps) {
  const ids = [...selectedIds];
  const { bulkDelete, bulkMove } = useFileMutations(onDone);

  function handleDownload() {
    // Staggered — firing many downloads in the same tick gets a chunk of them
    // silently dropped by the browser's download throttling.
    files
      .filter((file) => selectedIds.has(file.id))
      .forEach((file, i) => setTimeout(() => downloadFile(file), i * 300));
  }

  function handleDelete() {
    if (!window.confirm(`Delete ${ids.length} document${ids.length > 1 ? "s" : ""}? This can't be undone.`)) return;
    bulkDelete.mutate(ids, { onSuccess: onClear });
  }

  function handleMove(folderId: string | null) {
    bulkMove.mutate({ ids, folderId }, { onSuccess: onClear });
  }

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/[0.08] bg-popover px-3 py-2 shadow-2xl">
        <span className="px-1.5 text-[12.5px] font-medium text-foreground">{ids.length} selected</span>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex cursor-pointer items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[12px] text-foreground hover:bg-white/10">
            <FolderInput className="h-3.5 w-3.5" />
            Move to
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => handleMove(null)}>Ungrouped</DropdownMenuItem>
            {folders.map((folder) => (
              <DropdownMenuItem key={folder.id} onClick={() => handleMove(folder.id)}>
                {folder.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDownload}
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          title="Clear selection"
          className="rounded-full text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}
