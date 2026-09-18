export type DocumentKind = "pdf" | "word";

/** What one album row holds. Photos and documents share the album tables
 *  rather than living in two parallel stacks — an album is "the things that
 *  belong together", and a spec sheet belongs next to the screenshots of the
 *  thing it specifies. */
export type AlbumItemKind = "image" | DocumentKind;

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

export const ALBUM_ACCEPT = `image/*,${DOCUMENT_ACCEPT}`;

export const ALBUM_TYPE_ERROR = "Only images, PDFs and Word files (.pdf, .doc, .docx) can go here.";

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

/** What an album would store this file as, or null if it takes it at all. */
export function classifyAlbumFile(file: { type: string; name: string }): AlbumItemKind | null {
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

/** The thumbnail an album tile should show, or null when the kind has none
 *  (Word) — the caller renders a file-type card instead of a fake preview. */
export function albumThumbnailUrl(item: { kind: string; url: string }): string | null {
  if (item.kind === "image") return item.url;
  if (item.kind === "pdf") return pdfThumbnailUrl(item.url);
  return null;
}

export function documentLabel(kind: string): string {
  return kind === "word" ? "Word" : "PDF";
}
