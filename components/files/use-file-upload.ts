"use client";

import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { addFileToLibrary } from "@/lib/actions/files";
import { classifyDocumentFile, DOCUMENT_RESOURCE_TYPE, DOCUMENT_TYPE_ERROR } from "@/lib/canvas/document-file";
import { unwrapAction } from "@/lib/query-utils";
import { toastManager } from "@/lib/toast";
import { uploadToCloudinary } from "@/lib/upload-client";

export type PendingUpload = { id: string; name: string; progress: number; error?: string };

const MAX_BYTES = 25 * 1024 * 1024;

/** Uploads straight to Cloudinary (no file bytes through our server, see
 *  lib/upload-client.ts), then records the result against this library/folder.
 *  Per-file progress is exposed so the grid can show a real placeholder tile
 *  rather than uploads happening invisibly. Mirrors useAlbumUpload. */
export function useFileUpload(libraryId: string, folderId: string | null, onUploaded: () => void) {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const nextId = useRef(0);

  const attachMutation = useMutation({
    mutationFn: (input: Parameters<typeof addFileToLibrary>[0]) => unwrapAction(addFileToLibrary(input)),
  });

  function uploadOne(file: File) {
    const kind = classifyDocumentFile(file.type, file.name);
    if (!kind) {
      toastManager.add({ title: `${file.name} isn't supported`, description: DOCUMENT_TYPE_ERROR, type: "error" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toastManager.add({ title: `${file.name} is too large`, description: "Maximum size is 25MB.", type: "error" });
      return;
    }

    const localId = `pending-${nextId.current++}`;
    setPending((prev) => [{ id: localId, name: file.name, progress: 0 }, ...prev]);

    uploadToCloudinary(file, (progress) => {
      setPending((prev) => prev.map((p) => (p.id === localId ? { ...p, progress } : p)));
    })
      .then((result) => {
        attachMutation.mutate(
          {
            libraryId,
            folderId: folderId ?? undefined,
            url: result.url,
            cloudinaryPublicId: result.publicId,
            resourceType: DOCUMENT_RESOURCE_TYPE[kind],
            kind,
            name: file.name,
            bytes: result.bytes ?? file.size,
          },
          {
            onSuccess: () => {
              setPending((prev) => prev.filter((p) => p.id !== localId));
              onUploaded();
              toastManager.add({ title: `${file.name} uploaded`, type: "success" });
            },
            onError: (err) => {
              setPending((prev) => prev.map((p) => (p.id === localId ? { ...p, error: err.message } : p)));
              toastManager.add({ title: `${file.name} failed to attach`, description: err.message, type: "error" });
            },
          },
        );
      })
      .catch((err: Error) => {
        setPending((prev) => prev.map((p) => (p.id === localId ? { ...p, error: err.message } : p)));
        toastManager.add({ title: `${file.name} failed to upload`, description: err.message, type: "error" });
      });
  }

  /** Each file is judged on its own — one unsupported file in a drop of ten
   *  rejects itself and nothing else. */
  function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) uploadOne(file);
  }

  function dismissPending(id: string) {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  return { uploadFiles, pending, dismissPending };
}
