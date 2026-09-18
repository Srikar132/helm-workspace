"use client";

import { motion } from "framer-motion";
import { Download, FolderInput, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadItem } from "@/components/albums/album-grid";
import { useAlbumImageMutations } from "@/components/albums/use-album-image-mutations";
import type { AlbumGroupRow, AlbumImageRow } from "@/lib/actions/albums";

interface BulkActionBarProps {
  selectedIds: Set<string>;
  items: AlbumImageRow[];
  groups: AlbumGroupRow[];
  onClear: () => void;
  onDone: () => void;
}

export function BulkActionBar({ selectedIds, items, groups, onClear, onDone }: BulkActionBarProps) {
  const ids = [...selectedIds];
  const { bulkDelete, bulkMove } = useAlbumImageMutations(onDone);

  function handleDownload() {
    const selected = items.filter((item) => selectedIds.has(item.id));
    // Staggered — firing many downloads in the same tick gets a chunk of
    // them silently dropped by the browser's popup/download throttling.
    selected.forEach((item, i) => {
      setTimeout(() => downloadItem(item), i * 300);
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete ${ids.length} file${ids.length > 1 ? "s" : ""}? This can't be undone.`)) return;
    bulkDelete.mutate(ids, { onSuccess: onClear });
  }

  function handleMove(groupId: string | null) {
    bulkMove.mutate({ ids, groupId }, { onSuccess: onClear });
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
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[12px] text-foreground hover:bg-white/10 cursor-pointer">
            <FolderInput className="h-3.5 w-3.5" /> Move
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
            {groups.map((g) => (
              <DropdownMenuItem key={g.id} onClick={() => handleMove(g.id)}>
                {g.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => handleMove(null)}>Ungrouped</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="destructive"
          onClick={handleDelete}
          className="h-auto gap-1.5 rounded-full px-3 py-1.5 text-[12px]"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={handleDownload}
          className="hidden h-auto gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[12px] text-foreground hover:bg-white/10 sm:flex"
        >
          <Download className="h-3.5 w-3.5" /> Download
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
