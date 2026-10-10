export type DocumentKind = "pdf" | "word";

/** What one gallery row holds. Photos and documents share the gallery tables
 *  rather than living in two parallel stacks — a gallery is "the things that
 *  belong together", and a spec sheet belongs next to the screenshots of the
 *  thing it specifies. */
export type GalleryItemKind = "image" | DocumentKind;

/** Cloudinary resource type each document kind is stored under. PDFs go up as
 *  `image` because that is the only resource type Cloudinary will rasterise,
 *  which is where the first-page thumbnail comes from; Word files have no such
 *  transform without the paid conversion add-on, so they are plain `raw` blobs
 *  we only ever hand back whole. */
export const DOCUMENT_RESOURCE_TYPE: Record<DocumentKind, "image" | "raw"> = {
  pdf: "image",
  word: "raw",
};

export const DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const GALLERY_ACCEPT = `image/*,${DOCUMENT_ACCEPT}`;

export const GALLERY_TYPE_ERROR = "Only images, PDFs and Word files (.pdf, .doc, .docx) can go here.";

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

/** What a gallery would store this file as, or null if it takes it at all. */
export function classifyGalleryFile(file: { type: string; name: string }): GalleryItemKind | null {
  if (file.type.startsWith("image/")) return "image";
  return classifyDocumentFile(file.type, file.name);
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

/** The thumbnail a gallery tile should show, or null when the kind has none
 *  (Word) — the caller renders a file-type card instead of a fake preview. */
export function galleryThumbnailUrl(item: { kind: string; url: string }): string | null {
  if (item.kind === "image") return item.url;
  if (item.kind === "pdf") return pdfThumbnailUrl(item.url);
  return null;
}

/**
 * A right-sized (not blurred) thumbnail for the canvas photo-stack icon (see
 * gallery-widget.tsx) — this only ever renders at ~90px, so it asks Cloudinary
 * for a small crop instead of shipping the full-resolution original, but it's
 * still a sharp, real preview: the caller lazy-loads it, it doesn't fake one
 * by blurring it. Null for Word (no thumbnail) same as galleryThumbnailUrl.
 */
export function galleryStackThumbnailUrl(item: { kind: string; url: string }): string | null {
  if (item.kind === "word") return null;

  const marker = "/upload/";
  const at = item.url.indexOf(marker);
  if (at === -1) return galleryThumbnailUrl(item);

  const head = item.url.slice(0, at + marker.length);
  const tail = item.url.slice(at + marker.length);

  if (item.kind === "pdf") {
    const jpeg = tail.replace(/\.pdf(\?.*)?$/i, ".jpg$1");
    return `${head}f_jpg,pg_1,w_180,q_auto,c_fill/${jpeg}`;
  }
  return `${head}w_180,q_auto,c_fill,f_auto/${tail}`;
}

export function documentLabel(kind: string): string {
  return kind === "word" ? "Word" : "PDF";
}

const UPLOAD_MARKER = "/upload/";

/**
 * File name safe to put inside a Cloudinary `fl_attachment:<name>` segment.
 *
 * The segment is parsed by Cloudinary, so a name carrying `/`, `,`, `?`, `#`
 * or `%` would either end the transformation early or inject another one.
 * Only ASCII word characters survive; the extension is dropped because
 * Cloudinary appends the delivered format's own.
 */
export function downloadFileName(item: { name?: string | null; kind: string }): string {
  const fallback = item.kind === "image" ? "image" : item.kind === "video" ? "video" : "document";
  const base = (item.name ?? "").trim().replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const safe = base
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return safe || fallback;
}

/**
 * URL that makes the browser DOWNLOAD the asset instead of opening it.
 *
 * `<a download>` is ignored for cross-origin URLs, so the header has to come
 * from the server: Cloudinary's `fl_attachment` flag answers with
 * `Content-Disposition: attachment`. That needs no CORS, streams without
 * loading the file into memory and works on iOS Safari. Word files are `raw`
 * assets whose public id already carries the extension, so they get the bare
 * flag and keep their own name. A URL with no `/upload/` segment is returned
 * unchanged.
 */
export function attachmentUrl(item: { url: string; name?: string | null; kind: string }): string {
  const at = item.url.indexOf(UPLOAD_MARKER);
  if (at === -1) return item.url;

  const head = item.url.slice(0, at + UPLOAD_MARKER.length);
  const tail = item.url.slice(at + UPLOAD_MARKER.length);
  const flag = item.kind === "word" ? "fl_attachment" : `fl_attachment:${downloadFileName(item)}`;
  return `${head}${flag}/${tail}`;
}

/** The same image as a PNG — the one format every browser's async clipboard
 *  accepts. Unchanged if the URL isn't a Cloudinary upload URL. */
export function pngUrl(url: string): string {
  const at = url.indexOf(UPLOAD_MARKER);
  if (at === -1) return url;
  return `${url.slice(0, at + UPLOAD_MARKER.length)}f_png/${url.slice(at + UPLOAD_MARKER.length)}`;
}
