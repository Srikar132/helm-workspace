"use client";

import { useMutation } from "@tanstack/react-query";
import {
  bulkDeleteImagesAction,
  bulkMoveImagesAction,
  copyImageAction,
  deleteImageAction,
  moveImageToGroupAction,
  renameImageAction,
} from "@/lib/actions/albums";
import { unwrapAction } from "@/lib/query-utils";
import { toastManager } from "@/lib/toast";

function errorToast(title: string, err: Error) {
  toastManager.add({ title, description: err.message, type: "error" });
}

/** Shared by album-grid.tsx's per-tile menu, lightbox.tsx's action bar, and
 *  bulk-action-bar.tsx — the same six write paths, previously duplicated
 *  (rename/delete/duplicate/move ×2, bulk delete/move) across those files
 *  as raw `.then(onChanged)` calls. */
export function useAlbumImageMutations(onChanged: () => void) {
  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) => unwrapAction(renameImageAction(input.id, input.name)),
    onSuccess: () => {
      onChanged();
      toastManager.add({ title: "File renamed", type: "success" });
    },
    onError: (err) => errorToast("Failed to rename file", err),
  });

  const duplicate = useMutation({
    mutationFn: (input: { id: string; targetGroupId?: string | null }) =>
      unwrapAction(copyImageAction(input.id, input.targetGroupId)),
    onSuccess: () => {
      onChanged();
      toastManager.add({ title: "File duplicated", type: "success" });
    },
    onError: (err) => errorToast("Failed to duplicate file", err),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrapAction(deleteImageAction(id)),
    onSuccess: () => {
      onChanged();
      toastManager.add({ title: "File deleted", type: "success" });
    },
    onError: (err) => errorToast("Failed to delete file", err),
  });

  const move = useMutation({
    mutationFn: (input: { id: string; groupId: string | null }) =>
      unwrapAction(moveImageToGroupAction(input.id, input.groupId)),
    onSuccess: (_data, input) => {
      onChanged();
      toastManager.add({ title: input.groupId ? "File moved" : "Removed from group", type: "success" });
    },
    onError: (err) => errorToast("Failed to move file", err),
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => unwrapAction(bulkDeleteImagesAction(ids)),
    onSuccess: (_data, ids) => {
      onChanged();
      toastManager.add({ title: `${ids.length} file${ids.length > 1 ? "s" : ""} deleted`, type: "success" });
    },
    onError: (err) => errorToast("Failed to delete files", err),
  });

  const bulkMove = useMutation({
    mutationFn: (input: { ids: string[]; groupId: string | null }) =>
      unwrapAction(bulkMoveImagesAction(input.ids, input.groupId)),
    onSuccess: (_data, input) => {
      onChanged();
      toastManager.add({
        title: `${input.ids.length} file${input.ids.length > 1 ? "s" : ""} moved`,
        type: "success",
      });
    },
    onError: (err) => errorToast("Failed to move files", err),
  });

  return { rename, duplicate, remove, move, bulkDelete, bulkMove };
}
