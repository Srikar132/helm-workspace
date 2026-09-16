import { describe, expect, it } from "vitest";
import {
  AUTO_HEIGHT_MIN,
  KNOWN_WIDGET_TYPES,
  MULTI_INSTANCE_WIDGET_TYPES,
  NEW_WIDGET_DEFAULTS,
  widgetTitle,
} from "@/components/canvas/widget-registry";
import { classifyDocumentFile, DOCUMENT_RESOURCE_TYPE } from "@/lib/canvas/document-file";

/** The cursor format `getLibraryFiles` encodes and decodes. Duplicated here
 *  rather than exported from the action module, which is "use server" and
 *  cannot be imported into a node test. */
function encodeCursor(row: { createdAt: Date; id: string }) {
  return `${row.createdAt.toISOString()},${row.id}`;
}

function decodeCursor(cursor: string) {
  const [createdAt, id] = cursor.split(",");
  return { createdAt, id };
}

describe("library file cursor", () => {
  it("round trips, keeping the id tiebreaker for same-millisecond uploads", () => {
    const row = { createdAt: new Date("2026-09-17T10:20:30.123Z"), id: "3f1d9c88-0000-4000-8000-000000000001" };
    const decoded = decodeCursor(encodeCursor(row));
    expect(decoded.createdAt).toBe("2026-09-17T10:20:30.123Z");
    expect(decoded.id).toBe(row.id);
    expect(new Date(decoded.createdAt!).getTime()).toBe(row.createdAt.getTime());
  });

  it("splits on the first comma only — an ISO timestamp has none of its own", () => {
    expect(encodeCursor({ createdAt: new Date(0), id: "abc" }).split(",")).toHaveLength(2);
  });
});

describe("what a library accepts", () => {
  // The library is documents-only on purpose: photos live in albums, and
  // nothing should be storable in both.
  it("takes PDFs and Word files and nothing else", () => {
    expect(classifyDocumentFile("application/pdf", "spec.pdf")).toBe("pdf");
    expect(classifyDocumentFile("application/msword", "old.doc")).toBe("word");
    expect(classifyDocumentFile("image/png", "shot.png")).toBeNull();
    expect(classifyDocumentFile("video/mp4", "clip.mp4")).toBeNull();
  });

  // A Word file destroyed under the wrong resource type reports "not found"
  // and leaks — the row records the right one so the delete is exact.
  it("maps each kind to the Cloudinary resource type it is stored under", () => {
    expect(DOCUMENT_RESOURCE_TYPE.pdf).toBe("image");
    expect(DOCUMENT_RESOURCE_TYPE.word).toBe("raw");
  });
});

describe("files widget registration", () => {
  it("is a known, multi-instance widget type", () => {
    expect(KNOWN_WIDGET_TYPES.has("files")).toBe(true);
    // A workspace can hold several libraries, so this must never be
    // backfilled as a pinned default the way board/mail-summary are.
    expect(MULTI_INSTANCE_WIDGET_TYPES.has("files")).toBe(true);
  });

  it("sizes to its own content, with a floor", () => {
    expect(NEW_WIDGET_DEFAULTS.files.height).toBeUndefined();
    expect(AUTO_HEIGHT_MIN.files).toBeGreaterThan(0);
  });

  it("is titled Files", () => {
    expect(widgetTitle("files")).toBe("Files");
  });
});
