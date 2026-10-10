"use client";

import { Download, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface DocumentViewerOverlayProps {
  url: string;
  name: string;
  onClose: () => void;
}

/**
 * Reading a PDF happens here rather than inside the widget card — same call as
 * MailReaderOverlay: a card is a few hundred pixels wide sitting under the
 * canvas's pan/zoom transform, and a document is a full page. Portalled, so it
 * is sized against the viewport instead of the card.
 *
 * The iframe points straight at the Cloudinary URL and lets the browser's own
 * PDF viewer render it. Word files never reach here (nothing in a browser can
 * render one) — their card downloads instead.
 */
export function DocumentViewerOverlay({ url, name, onClose }: DocumentViewerOverlayProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl border border-white/[0.08] p-0 sm:max-w-5xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-3.5 pr-12">
          <DialogTitle className="truncate text-[14px] font-semibold text-foreground">{name}</DialogTitle>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in a new tab"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <a
              href={url}
              download={name}
              title="Download"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <Download className="h-4 w-4" />
            </a>
          </div>
        </div>

        <iframe
          src={url}
          title={name}
          className="min-h-0 flex-1 border-0 bg-zinc-900"
        />
      </DialogContent>
    </Dialog>
  );
}
