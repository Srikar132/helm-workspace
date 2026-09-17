"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { DOCUMENT_ACCEPT } from "@/lib/canvas/document-file";

interface UploadDropzoneProps {
  uploadFiles: (files: FileList | File[]) => void;
  className?: string;
  children: React.ReactNode;
}

/** Just the click-to-pick trigger — the upload function itself is owned by
 *  useFileUpload in LibraryView, so the same path also backs dropping files
 *  onto the page. */
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
        accept={DOCUMENT_ACCEPT}
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
