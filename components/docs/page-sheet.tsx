"use client";

import type { Editor, JSONContent } from "@tiptap/react";
import { TiptapEditor } from "@/components/docs/tiptap-editor";
import type { DocPageRow } from "@/lib/actions/docs";

interface PageSheetProps {
  page: DocPageRow;
  canWrite: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
  onChange: (json: JSONContent) => void;
  onFocusEditor: (editor: Editor) => void;
  slug?: string;
}

/** A single page — starts Letter-proportioned (the aspect-[...] class is
 *  just a minimum shape) and grows naturally with content; nothing clips
 *  it and nothing auto-splits it. Real pagination happens at export time
 *  via the browser's print engine, not while editing. */
export function PageSheet({ page, canWrite, registerRef, onChange, onFocusEditor, slug }: PageSheetProps) {
  return (
    <div
      ref={registerRef}
      data-page-id={page.id}
      className="aspect-[816/1056] w-full rounded-lg bg-white shadow-2xl print:aspect-auto print:rounded-none print:shadow-none"
    >
      {/* No h-full anywhere in this chain, on purpose — a percentage-height
          child never counts as "content" toward an ancestor's auto/content
          sizing, so with h-full here the white box stayed pinned at the
          aspect-ratio height while the actual (non-percentage) text still
          grew and spilled straight past it, unclipped. Plain block flow
          lets real content height drive growth correctly instead. */}
      <div className="px-5 py-8 text-[#1a1a1a] sm:px-10 sm:py-12 md:px-16 md:py-14 print:p-0">
        <TiptapEditor
          content={page.content}
          editable={canWrite}
          slug={slug}
          onChange={onChange}
          onFocusEditor={onFocusEditor}
          className="prose-page text-[13.5px] sm:text-[14px]"
        />
      </div>
    </div>
  );
}
