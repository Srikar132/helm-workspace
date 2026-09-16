import { describe, expect, it } from "vitest";
import {
  classifyDocumentFile,
  DOCUMENT_MIME_PATTERN,
  formatFileSize,
  isDocumentFile,
  pdfThumbnailUrl,
  readDocumentData,
} from "@/lib/canvas/document-file";

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

describe("DOCUMENT_MIME_PATTERN", () => {
  it("matches exactly the accepted document types", () => {
    expect(DOCUMENT_MIME_PATTERN.test("application/pdf")).toBe(true);
    expect(DOCUMENT_MIME_PATTERN.test("application/msword")).toBe(true);
    expect(DOCUMENT_MIME_PATTERN.test("image/png")).toBe(false);
    // Anchored on both ends — the paste handler ORs this into a larger
    // pattern, and an unanchored version would match half of any MIME type.
    expect(DOCUMENT_MIME_PATTERN.test("x-application/pdf-ish")).toBe(false);
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

describe("readDocumentData", () => {
  it("reads a finished document", () => {
    expect(
      readDocumentData({
        status: "ready",
        url: "https://res.cloudinary.com/demo/raw/upload/v1/a.docx",
        cloudinaryPublicId: "helm-canvas/org_1/a.docx",
        kind: "word",
        name: "a.docx",
        bytes: 1024,
      }),
    ).toEqual({
      status: "ready",
      url: "https://res.cloudinary.com/demo/raw/upload/v1/a.docx",
      cloudinaryPublicId: "helm-canvas/org_1/a.docx",
      kind: "word",
      name: "a.docx",
      bytes: 1024,
    });
  });

  it("treats a widget with no data as an empty picker, not a stuck upload", () => {
    expect(readDocumentData(undefined)).toEqual({ status: "empty" });
    expect(readDocumentData({})).toEqual({ status: "empty" });
  });

  it("survives a row written by older or broken code", () => {
    // ready without a url is not ready
    expect(readDocumentData({ status: "ready" })).toEqual({ status: "empty" });
    expect(readDocumentData({ status: "error" })).toEqual({ status: "error", message: "Upload failed." });
    expect(readDocumentData({ status: "ready", url: "u" })).toMatchObject({ kind: "pdf", name: "Document", bytes: 0 });
  });
});
