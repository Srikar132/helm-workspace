"use client";

import dynamic from "next/dynamic";
import { CanvasChrome } from "@/components/canvas/canvas-chrome";
import type { BoardColumn } from "@/lib/worklog";
import type { WidgetLayoutItem } from "@/lib/db";
import type { DocProjectSummary } from "@/lib/actions/docs";
import type { AlbumPreview } from "@/lib/actions/albums";
import type { GmailStatus } from "@/lib/actions/gmail";
import type { GmailMessageSummary } from "@/lib/gmail";
import { Landmark } from "@/lib/actions/landmarks";
// react-flow + dnd-kit + every widget component (Tiptap included, via
// widget-node.tsx's static imports) all hang off this one import — code-
// splitting it keeps that whole bundle out of the initial route JS. No SSR:
// react-flow measures the DOM on mount, so a server-rendered pass buys
// nothing here anyway.
const CanvasShell = dynamic(() => import("@/components/canvas/canvas-shell").then((m) => m.CanvasShell), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#1e1f20]" />,
});

interface WorkspaceDashboardProps {
  slug: string;
  columns: BoardColumn[];
  canWrite: boolean;
  initialLayout: WidgetLayoutItem[];
  initialProjectSummaries: Record<string, DocProjectSummary>;
  initialAlbumPreviews: Record<string, AlbumPreview>;
  initialGmailStatus: GmailStatus;
  initialGmailMessages?: GmailMessageSummary[];
  initialLandmarks: Record<string, Landmark>;
  /** The workspace's HOME landmark — the canvas opens centered on it. */
  initialDefaultLandmark?: Landmark | null;
}

// The QueryClient itself lives at the root layout (app/providers.tsx) —
// scoped here, it got torn down and rebuilt on every client-side nav away
// from and back to the canvas, wiping the whole cache each time. Query keys
// (["docProject", id], ["albumPreview", id], ...) are already unique by
// UUID, so sharing one client across workspace switches doesn't risk any
// cross-workspace bleed.
export function WorkspaceDashboard({
  slug,
  columns,
  canWrite,
  initialLayout,
  initialProjectSummaries,
  initialAlbumPreviews,
  initialGmailStatus,
  initialGmailMessages,
  initialLandmarks,
  initialDefaultLandmark,
}: WorkspaceDashboardProps) {
  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-[#1e1f20] text-[#e8eaed] font-sans">
      <CanvasShell
        slug={slug}
        initialLayout={initialLayout}
        columns={columns}
        canWrite={canWrite}
        initialProjectSummaries={initialProjectSummaries}
        initialAlbumPreviews={initialAlbumPreviews}
        initialGmailStatus={initialGmailStatus}
        initialGmailMessages={initialGmailMessages}
        initialLandmarks={initialLandmarks}
        initialDefaultLandmark={initialDefaultLandmark}
      />
      <CanvasChrome />
    </div>
  );
}
