"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ALBUM_ACCEPT } from "@/lib/album-file";

interface UploadDropzoneProps {
  uploadFiles: (files: FileList | File[]) => void;
  className?: string;
  children: React.ReactNode;
}

/** Just the click-to-pick trigger — the actual upload function is owned by
 *  useAlbumUpload in AlbumView so the same upload path also backs
 *  drag-and-drop onto the grid, not just this button. */
export function UploadDropzone({ uploadFiles, className, children }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button type="button" onClick={() => inputRef.current?.click()} className={className}>
        {children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ALBUM_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}
