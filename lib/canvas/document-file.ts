export type DocumentKind = "pdf" | "word";

/** Cloudinary resource type each kind is stored under. PDFs go up as `image`
 *  because that is the only resource type Cloudinary will rasterise, which is
 *  where the first-page thumbnail comes from; Word files have no such
 *  transform without the paid conversion add-on, so they are plain `raw`
 *  blobs we only ever hand back whole. */
export const DOCUMENT_RESOURCE_TYPE: Record<DocumentKind, "image" | "raw"> = {
  pdf: "image",
  word: "raw",
};

export const DOCUMENT_MIME_PATTERN =
  /^application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/;

export const DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const DOCUMENT_TYPE_ERROR = "Only PDF and Word files (.pdf, .doc, .docx) can go here.";

const WORD_MIME = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * What kind of document this file is, or null if it isn't one.
 *
 * Extension is consulted as well as the MIME type, not instead of it: a file
 * dragged from some archive tools and a few Windows configurations arrives with
 * an empty or `application/octet-stream` type, and rejecting those would refuse
 * a perfectly ordinary .docx for reasons the user cannot see.
 */
export function classifyDocumentFile(mime: string, name = ""): DocumentKind | null {
  if (mime === "application/pdf") return "pdf";
  if (WORD_MIME.has(mime)) return "word";

  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".doc" || ext === ".docx") return "word";
  return null;
}

export function isDocumentFile(file: { type: string; name: string }): boolean {
  return classifyDocumentFile(file.type, file.name) !== null;
}

const SIZE_UNITS = ["B", "KB", "MB", "GB"];

/** "1.4 MB". Sizes are for orientation, not accounting — one decimal place
 *  above KB, none below. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${SIZE_UNITS[unit]}`;
}

/**
 * Cloudinary URL for page 1 of a PDF, as a JPEG.
 *
 * The transformation has to sit directly after `/upload/` (Cloudinary reads the
 * segment in that position and nowhere else), and the delivered extension is
 * swapped too — `f_jpg` already forces the format, but leaving `.pdf` on the end
 * makes every one of these URLs look like a PDF link in the network tab and in
 * anything that sniffs by extension.
 */
export function pdfThumbnailUrl(url: string): string {
  const marker = "/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return url;

  const head = url.slice(0, at + marker.length);
  const tail = url.slice(at + marker.length);
  const jpeg = tail.replace(/\.pdf(\?.*)?$/i, ".jpg$1");
  return `${head}f_jpg,pg_1,w_640,q_auto/${jpeg}`;
}

export type DocumentData =
  | { status: "empty" }
  | { status: "uploading" }
  | {
      status: "ready";
      url: string;
      cloudinaryPublicId?: string;
      kind: DocumentKind;
      name: string;
      bytes: number;
    }
  | { status: "error"; message: string };

/** The widget's persisted `data` JSONB, narrowed. Anything unrecognised reads
 *  as an empty card rather than throwing — a widget row outlives the code that
 *  wrote it. */
export function readDocumentData(data: Record<string, unknown> | undefined): DocumentData {
  if (data?.status === "ready" && typeof data.url === "string") {
    return {
      status: "ready",
      url: data.url,
      cloudinaryPublicId: typeof data.cloudinaryPublicId === "string" ? data.cloudinaryPublicId : undefined,
      kind: data.kind === "word" ? "word" : "pdf",
      name: typeof data.name === "string" && data.name ? data.name : "Document",
      bytes: typeof data.bytes === "number" ? data.bytes : 0,
    };
  }
  if (data?.status === "uploading") return { status: "uploading" };
  if (data?.status === "error") {
    return { status: "error", message: typeof data.message === "string" ? data.message : "Upload failed." };
  }
  return { status: "empty" };
}
