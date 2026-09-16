"use client";

import { useMutation } from "@tanstack/react-query";
import {
  bulkDeleteLibraryFilesAction,
  bulkMoveLibraryFilesAction,
  deleteLibraryFileAction,
  moveLibraryFileAction,
  renameLibraryFileAction,
} from "@/lib/actions/files";
import { unwrapAction } from "@/lib/query-utils";
import { toastManager } from "@/lib/toast";

function errorToast(title: string, err: Error) {
  toastManager.add({ title, description: err.message, type: "error" });
}

/** Shared by the grid's per-tile menu and the bulk action bar — the same five
 *  write paths, in one place, so they can't drift. Mirrors
 *  useAlbumImageMutations. */
export function useFileMutations(onChanged: () => void) {
  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) => unwrapAction(renameLibraryFileAction(input.id, input.name)),
    onSuccess: () => {
      onChanged();
      toastManager.add({ title: "Document renamed", type: "success" });
    },
    onError: (err) => errorToast("Failed to rename document", err),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrapAction(deleteLibraryFileAction(id)),
    onSuccess: () => {
      onChanged();
      toastManager.add({ title: "Document deleted", type: "success" });
    },
    onError: (err) => errorToast("Failed to delete document", err),
  });

  const move = useMutation({
    mutationFn: (input: { id: string; folderId: string | null }) =>
      unwrapAction(moveLibraryFileAction(input.id, input.folderId)),
    onSuccess: (_data, input) => {
      onChanged();
      toastManager.add({ title: input.folderId ? "Document moved" : "Removed from folder", type: "success" });
    },
    onError: (err) => errorToast("Failed to move document", err),
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => unwrapAction(bulkDeleteLibraryFilesAction(ids)),
    onSuccess: (_data, ids) => {
      onChanged();
      toastManager.add({ title: `${ids.length} document${ids.length > 1 ? "s" : ""} deleted`, type: "success" });
    },
    onError: (err) => errorToast("Failed to delete documents", err),
  });

  const bulkMove = useMutation({
    mutationFn: (input: { ids: string[]; folderId: string | null }) =>
      unwrapAction(bulkMoveLibraryFilesAction(input.ids, input.folderId)),
    onSuccess: (_data, input) => {
      onChanged();
      toastManager.add({
        title: `${input.ids.length} document${input.ids.length > 1 ? "s" : ""} moved`,
        type: "success",
      });
    },
    onError: (err) => errorToast("Failed to move documents", err),
  });

  return { rename, remove, move, bulkDelete, bulkMove };
}
