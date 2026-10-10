"use client";

import { Copy, FolderInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface MoveDuplicateDialogProps {
  imageCount: number;
  groupName: string;
  onMove: () => void;
  onDuplicate: () => void;
  onOpenChange: (open: boolean) => void;
}

/** Shown when a file (or a multi-selection) is dropped onto a sidebar group
 *  — dnd-kit only tells us WHERE it landed, not whether the user meant to
 *  relocate it or keep the original and branch a copy, so we ask. Duplicate
 *  only applies to a single-image drop (no bulk-duplicate action exists). */
export function MoveDuplicateDialog({ imageCount, groupName, onMove, onDuplicate, onOpenChange }: MoveDuplicateDialogProps) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-sm rounded-2xl border border-white/[0.08] bg-popover p-5 shadow-2xl">
        <DialogTitle className="text-[14px] text-foreground">
          {imageCount > 1 ? `Move ${imageCount} files` : "Move file"} to &quot;{groupName}&quot;?
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-[12.5px] text-muted-foreground">
          Move takes {imageCount > 1 ? "them" : "it"} out of the current group.
          {imageCount === 1 && " Duplicate keeps the original in place and adds a copy instead."}
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-auto rounded-full px-3 py-1.5 text-[12.5px] text-muted-foreground"
          >
            Cancel
          </Button>
          {imageCount === 1 && (
            <Button
              type="button"
              variant="ghost"
              onClick={onDuplicate}
              className="h-auto gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[12.5px] text-foreground hover:bg-white/10"
            >
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            onClick={onMove}
            className="h-auto gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
          >
            <FolderInput className="h-3.5 w-3.5" /> Move
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
