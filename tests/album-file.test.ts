import { describe, expect, it } from "vitest";
import {
  albumThumbnailUrl,
  classifyAlbumFile,
  classifyDocumentFile,
  DOCUMENT_RESOURCE_TYPE,
  formatFileSize,
  isDocumentFile,
  pdfThumbnailUrl,
} from "@/lib/album-file";

describe("classifyDocumentFile", () => {
  it("classifies by MIME type", () => {
    expect(classifyDocumentFile("application/pdf", "a.pdf")).toBe("pdf");
    expect(
      classifyDocumentFile(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe("word");
    expect(classifyDocumentFile("application/msword", "a.doc")).toBe("word");
  });

  // The whole reason the filename is consulted at all: some drops arrive with
  // no usable type.
  it("falls back to the extension when the MIME type is missing or generic", () => {
    expect(classifyDocumentFile("", "report.pdf")).toBe("pdf");
    expect(classifyDocumentFile("application/octet-stream", "Notes.DOCX")).toBe("word");
  });

  it("rejects anything else", () => {
    expect(classifyDocumentFile("image/png", "a.png")).toBeNull();
    expect(classifyDocumentFile("application/zip", "a.zip")).toBeNull();
    expect(classifyDocumentFile("text/plain", "a.txt")).toBeNull();
    // A name that merely contains ".pdf" is not a PDF.
    expect(classifyDocumentFile("application/zip", "not-a.pdf.zip")).toBeNull();
  });

  it("isDocumentFile reads type and name together", () => {
    expect(isDocumentFile({ type: "application/pdf", name: "x.pdf" })).toBe(true);
    expect(isDocumentFile({ type: "video/mp4", name: "x.mp4" })).toBe(false);
  });
});

describe("classifyAlbumFile", () => {
  it("takes photos and documents, and nothing else", () => {
    expect(classifyAlbumFile({ type: "image/png", name: "shot.png" })).toBe("image");
    expect(classifyAlbumFile({ type: "application/pdf", name: "spec.pdf" })).toBe("pdf");
    expect(classifyAlbumFile({ type: "", name: "notes.docx" })).toBe("word");
    // Video uploads still exist on the canvas, but an album isn't where they go.
    expect(classifyAlbumFile({ type: "video/mp4", name: "clip.mp4" })).toBeNull();
    expect(classifyAlbumFile({ type: "application/zip", name: "a.zip" })).toBeNull();
  });
});

describe("DOCUMENT_RESOURCE_TYPE", () => {
  // A Word file destroyed under the wrong resource type reports "not found"
  // and leaks — the row records the right one so the delete is exact.
  it("maps each kind to the Cloudinary resource type it is stored under", () => {
    expect(DOCUMENT_RESOURCE_TYPE.pdf).toBe("image");
    expect(DOCUMENT_RESOURCE_TYPE.word).toBe("raw");
  });
});

describe("formatFileSize", () => {
  it("scales to the largest sensible unit", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_500_000)).toBe("1.4 MB");
  });

  it("has an em dash for nothing useful", () => {
    expect(formatFileSize(0)).toBe("—");
    expect(formatFileSize(Number.NaN)).toBe("—");
  });
});

describe("pdfThumbnailUrl", () => {
  const url =
    "https://res.cloudinary.com/demo/image/upload/v1712345678/helm-canvas/org_1/spec.pdf";

  it("inserts the transformation right after /upload/ and delivers a jpeg", () => {
    expect(pdfThumbnailUrl(url)).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_jpg,pg_1,w_640,q_auto/v1712345678/helm-canvas/org_1/spec.jpg",
    );
  });

  it("leaves a URL it doesn't recognise alone", () => {
    expect(pdfThumbnailUrl("https://example.com/spec.pdf")).toBe("https://example.com/spec.pdf");
  });
});

describe("albumThumbnailUrl", () => {
  const pdf = "https://res.cloudinary.com/demo/image/upload/v1/spec.pdf";

  it("shows a photo as itself and a PDF as its first page", () => {
    expect(albumThumbnailUrl({ kind: "image", url: "https://res.cloudinary.com/demo/image/upload/v1/a.png" })).toBe(
      "https://res.cloudinary.com/demo/image/upload/v1/a.png",
    );
    expect(albumThumbnailUrl({ kind: "pdf", url: pdf })).toContain("f_jpg,pg_1");
  });

  // Nothing Cloudinary can render without the paid conversion add-on, so the
  // tile draws a file-type card instead of a fake preview.
  it("has nothing to show for a Word file", () => {
    expect(albumThumbnailUrl({ kind: "word", url: "https://res.cloudinary.com/demo/raw/upload/v1/a.docx" })).toBeNull();
  });
});
