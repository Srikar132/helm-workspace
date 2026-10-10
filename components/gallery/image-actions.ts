import { attachmentUrl, downloadFileName, pngUrl } from "@/lib/gallery-file";
import { toastManager } from "@/lib/toast";

/** What these actions need from a gallery row. */
export interface ActionItem {
  url: string;
  name?: string | null;
  kind: string;
}

function notify(type: "success" | "error", title: string, description?: string) {
  toastManager.add({ title, description, type });
}

function clickAnchor(href: string, download: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = download;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Last resort for a URL we cannot ask the server to serve as an attachment:
 *  pull the bytes and hand the browser a same-origin object URL, which DOES
 *  honour `download`. Needs CORS, so it can fail — and says so. */
async function downloadViaBlob(item: ActionItem) {
  try {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const objectUrl = URL.createObjectURL(await res.blob());
    clickAnchor(objectUrl, downloadFileName(item));
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch {
    notify("error", "Download failed", "The file could not be fetched. Try Copy link instead.");
  }
}

/**
 * Download the file. `<a download>` is ignored for cross-origin URLs, so a
 * Cloudinary URL is rewritten to carry `fl_attachment`, which makes the
 * server answer with `Content-Disposition: attachment` — a real download
 * rather than a new tab. An anchor click cannot report failure, so the toast
 * says the download started, not that it finished.
 */
export function downloadItem(item: ActionItem, options: { quiet?: boolean } = {}) {
  const href = attachmentUrl(item);
  if (href === item.url) {
    void downloadViaBlob(item);
    return;
  }
  clickAnchor(href, downloadFileName(item));
  if (!options.quiet) notify("success", "Download started");
}

/** Copy the image itself (as a PNG, the one type every browser's clipboard
 *  takes). Images only — callers don't offer this for documents. */
export async function copyImage(item: ActionItem): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    notify("error", "Can't copy the image here", "This browser doesn't allow copying images. Use Copy link or Download.");
    return;
  }

  // The blob goes in as a PROMISE so the write starts inside the click —
  // Safari rejects a write that only begins after an awaited fetch.
  const png = fetch(pngUrl(item.url)).then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.type !== "image/png") throw new Error(`Unexpected type ${blob.type}`);
    return blob;
  });

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    notify("success", "Image copied");
  } catch {
    notify("error", "Couldn't copy the image", "The browser blocked it or the image couldn't be loaded. Try Copy link.");
  }
}

export async function copyLink(item: ActionItem): Promise<void> {
  try {
    await navigator.clipboard.writeText(item.url);
    notify("success", "Link copied");
  } catch {
    notify("error", "Couldn't copy the link", "Clipboard access was blocked by the browser.");
  }
}
