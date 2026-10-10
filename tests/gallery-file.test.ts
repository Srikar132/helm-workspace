import { describe, expect, it } from "vitest";
import {
  galleryThumbnailUrl,
  attachmentUrl,
  classifyGalleryFile,
  classifyDocumentFile,
  DOCUMENT_RESOURCE_TYPE,
  downloadFileName,
  formatFileSize,
  isDocumentFile,
  pdfThumbnailUrl,
  pngUrl,
} from "@/lib/gallery-file";

describe("downloadFileName", () => {
  it("drops the extension and keeps a plain name", () => {
    expect(downloadFileName({ name: "Beach day.JPG", kind: "image" })).toBe("Beach_day");
  });

  // These characters would end or extend the Cloudinary transformation.
  it("strips characters that could break out of the transformation segment", () => {
    const name = downloadFileName({ name: "a/b,c?d#e%f", kind: "image" });
    expect(name).toBe("a_b_c_d_e_f");
    expect(name).not.toMatch(/[/,?#%]/);
  });

  it("falls back by kind when nothing usable is left", () => {
    expect(downloadFileName({ name: null, kind: "image" })).toBe("image");
    expect(downloadFileName({ name: "   ", kind: "pdf" })).toBe("document");
    expect(downloadFileName({ name: null, kind: "video" })).toBe("video");
    expect(downloadFileName({ name: "日本語.png", kind: "image" })).toBe("image");
  });

  it("caps the length", () => {
    expect(downloadFileName({ name: "x".repeat(300), kind: "image" }).length).toBe(80);
  });
});

describe("attachmentUrl", () => {
  const url = "https://res.cloudinary.com/demo/image/upload/v1/helm/pic.jpg";

  it("inserts the attachment flag right after /upload/", () => {
    expect(attachmentUrl({ url, name: "Beach day.jpg", kind: "image" })).toBe(
      "https://res.cloudinary.com/demo/image/upload/fl_attachment:Beach_day/v1/helm/pic.jpg",
    );
  });

  it("uses the bare flag for Word files so the stored extension is kept", () => {
    expect(
      attachmentUrl({ url: "https://res.cloudinary.com/demo/raw/upload/v1/a.docx", name: "Spec", kind: "word" }),
    ).toBe("https://res.cloudinary.com/demo/raw/upload/fl_attachment/v1/a.docx");
  });

  it("returns a non-Cloudinary URL unchanged", () => {
    expect(attachmentUrl({ url: "https://example.com/a.jpg", name: "a", kind: "image" })).toBe(
      "https://example.com/a.jpg",
    );
  });
});

describe("pngUrl", () => {
  it("asks Cloudinary for a PNG", () => {
    expect(pngUrl("https://res.cloudinary.com/demo/image/upload/v1/pic.webp")).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_png/v1/pic.webp",
    );
  });

  it("leaves other URLs alone", () => {
    expect(pngUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
  });
});

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

describe("classifyGalleryFile", () => {
  it("takes photos and documents, and nothing else", () => {
    expect(classifyGalleryFile({ type: "image/png", name: "shot.png" })).toBe("image");
    expect(classifyGalleryFile({ type: "application/pdf", name: "spec.pdf" })).toBe("pdf");
    expect(classifyGalleryFile({ type: "", name: "notes.docx" })).toBe("word");
    // Video uploads still exist on the canvas, but a gallery isn't where they go.
    expect(classifyGalleryFile({ type: "video/mp4", name: "clip.mp4" })).toBeNull();
    expect(classifyGalleryFile({ type: "application/zip", name: "a.zip" })).toBeNull();
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

describe("galleryThumbnailUrl", () => {
  const pdf = "https://res.cloudinary.com/demo/image/upload/v1/spec.pdf";

  it("shows a photo as itself and a PDF as its first page", () => {
    expect(galleryThumbnailUrl({ kind: "image", url: "https://res.cloudinary.com/demo/image/upload/v1/a.png" })).toBe(
      "https://res.cloudinary.com/demo/image/upload/v1/a.png",
    );
    expect(galleryThumbnailUrl({ kind: "pdf", url: pdf })).toContain("f_jpg,pg_1");
  });

  // Nothing Cloudinary can render without the paid conversion add-on, so the
  // tile draws a file-type card instead of a fake preview.
  it("has nothing to show for a Word file", () => {
    expect(galleryThumbnailUrl({ kind: "word", url: "https://res.cloudinary.com/demo/raw/upload/v1/a.docx" })).toBeNull();
  });
});
