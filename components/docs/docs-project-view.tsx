"use client";

import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileText,
  GitFork,
  Link2,
  Menu,
  Plus,
  Printer,
  X,
} from "lucide-react";
import Link from "next/link";
import type { Editor } from "@tiptap/react";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { GlobalToolbar } from "@/components/docs/global-toolbar";
import { PageSheet } from "@/components/docs/page-sheet";
import { Button } from "@/components/ui/button";
import {
  createDocPage,
  deleteDocPage,
  setDocProjectPublic,
  updateDocPage,
  type DocPageRow,
  type DocProjectSummary,
} from "@/lib/actions/docs";
import { unwrapAction } from "@/lib/query-utils";
import { toPlainJson } from "@/lib/utils";

interface DocsProjectViewProps {
  /** Omitted for the public share view — there's no workspace to go back
   *  to, so the back-to-canvas link doesn't render. */
  slug?: string;
  project: DocProjectSummary;
  initialPages: DocPageRow[];
  canWrite: boolean;
  /** From `?page=` — where a notification link wants to land. */
  initialPageId?: string;
}

export function DocsProjectView({ slug, project, initialPages, canWrite, initialPageId }: DocsProjectViewProps) {
  const [pages, setPages] = useState<DocPageRow[]>(initialPages);
  // "Which page is in view" — driven by scroll position (IntersectionObserver
  // below), not by a click swapping content. All pages render at once, like
  // scrolling through a real multi-page document; the sidebar just tracks
  // and jumps, it doesn't gate what's rendered.
  // A notification link lands on a specific page (?page=); an id that isn't
  // one of this project's pages falls back to the first, like a plain open.
  const linkedPageId = initialPages.some((p) => p.id === initialPageId) ? initialPageId! : null;
  const [activePageId, setActivePageId] = useState<string | null>(linkedPageId ?? initialPages[0]?.id ?? null);
  const [isPublic, setIsPublic] = useState(project.isPublic);
  const [shareCopied, setShareCopied] = useState(false);
  // Sidebar is a slide-in drawer below md; the md:translate-x-0 override
  // means this state is only ever visually meaningful on small screens.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // One toolbar for every page — it acts on whichever page's editor last
  // had focus. `toolbarTick` forces GlobalToolbar to re-render on every
  // transaction of that editor so active-state highlighting (bold/italic
  // lighting up) tracks the live cursor, not just which page is focused.
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [, setToolbarTick] = useState(0);

  useEffect(() => {
    if (!activeEditor) return;
    const rerender = () => setToolbarTick((t) => t + 1);
    activeEditor.on("transaction", rerender);
    return () => {
      activeEditor.off("transaction", rerender);
    };
  }, [activeEditor]);

  const pageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingScrollToId = useRef<string | null>(null);

  // Mount-only: bring the linked page into view once its sheet has a ref.
  const scrolledToLinkedPage = useRef(false);
  useEffect(() => {
    if (!linkedPageId || scrolledToLinkedPage.current) return;
    scrolledToLinkedPage.current = true;
    pageRefs.current.get(linkedPageId)?.scrollIntoView({ block: "start" });
  }, [linkedPageId]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const top = visible.reduce((a, b) => (a.intersectionRatio > b.intersectionRatio ? a : b));
        setActivePageId(top.target.getAttribute("data-page-id"));
      },
      { threshold: [0.15, 0.4, 0.6] },
    );
    for (const el of pageRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [pages]);

  useEffect(() => {
    if (!pendingScrollToId.current) return;
    const el = pageRefs.current.get(pendingScrollToId.current);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    // A freshly added page should be ready to type into immediately.
    el?.querySelector<HTMLElement>(".ProseMirror")?.focus();
    pendingScrollToId.current = null;
  }, [pages]);

  function scrollToPage(id: string) {
    setActivePageId(id);
    pageRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSidebarOpen(false);
  }

  const addPageMutation = useMutation({
    mutationFn: () => unwrapAction(createDocPage(project.id)),
    onSuccess: (res) => {
      if (!res.id) return;
      const newPage: DocPageRow = {
        id: res.id,
        docProjectId: project.id,
        title: "Untitled",
        content: null,
        position: (pages.at(-1)?.position ?? -1) + 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setPages((prev) => [...prev, newPage]);
      pendingScrollToId.current = res.id;
      setSidebarOpen(false);
    },
    onError: (err) => console.error("Failed to add page:", err),
  });

  const deletePageMutation = useMutation({
    mutationFn: (id: string) => unwrapAction(deleteDocPage(id, project.id)),
    onSuccess: (_res, id) => {
      pageRefs.current.delete(id);
      setPages((prev) => prev.filter((p) => p.id !== id));
    },
    onError: (err) => console.error("Failed to delete page:", err),
  });

  function handleDeletePage(id: string) {
    if (pages.length <= 1) return;
    deletePageMutation.mutate(id);
  }

  const savePageMutation = useMutation({
    mutationFn: (input: { pageId: string; patch: { title?: string; content?: Record<string, unknown> } }) =>
      unwrapAction(updateDocPage(input.pageId, input.patch)),
    onError: (err) => console.error("Failed to save page:", err),
  });

  function handlePageContentChange(pageId: string, json: Record<string, unknown>) {
    // The server is the authority (updateDocPage rejects with "View-only
    // access."), but a viewer should never generate the request in the first
    // place — it only produces console errors for something they didn't do.
    if (!canWrite) return;
    // Same null-prototype problem as the canvas note: ProseMirror mark attrs
    // don't survive the server-action boundary unless rebuilt as plain JSON, so
    // a doc page's text colour would vanish on save too (lib/plain-json.ts).
    const plain = toPlainJson(json);
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, content: plain } : p)));
    savePageMutation.mutate({ pageId, patch: { content: plain } });
  }

  const titleSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function handlePageTitleChange(pageId: string, title: string) {
    if (!canWrite) return;
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, title } : p)));
    const timers = titleSaveTimers.current;
    const existing = timers.get(pageId);
    if (existing) clearTimeout(existing);
    timers.set(
      pageId,
      setTimeout(() => {
        savePageMutation.mutate({ pageId, patch: { title } });
        timers.delete(pageId);
      }, 600),
    );
  }

  const shareToggleMutation = useMutation({
    mutationFn: (next: boolean) => unwrapAction(setDocProjectPublic(project.id, next)),
    onSuccess: (_res, next) => setIsPublic(next),
    onError: (err) => console.error("Failed to update sharing:", err),
  });

  function handleShareToggle() {
    shareToggleMutation.mutate(!isPublic);
  }

  async function handleCopyShareLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/share/docs/${project.shareToken}`);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1500);
  }

  return (
    <div className="flex h-screen flex-col bg-card text-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-card px-3 sm:gap-3 sm:px-4 print:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen((v) => !v)}
          title="Pages"
          className="rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground md:hidden"
        >
          <Menu className="h-4 w-4" />
        </Button>
        {slug && (
          <Link
            href={`/workspace/${slug}`}
            title="Back to canvas"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground sm:flex-none sm:text-[14px]">
          {project.title}
        </h1>

        <div className="hidden items-center gap-1 sm:flex">
          {project.githubLinks.map((link, i) => (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={link.label ?? link.url}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"
            >
              <GitFork className="h-3.5 w-3.5" />
            </a>
          ))}
          {project.liveLink && (
            <a
              href={project.liveLink}
              target="_blank"
              rel="noopener noreferrer"
              title="Live link"
              className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-400 hover:bg-white/10"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {canWrite && (
            <>
              {isPublic && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleCopyShareLink}
                  title="Copy link"
                  className="gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-white/10 hover:text-foreground sm:px-3"
                >
                  {shareCopied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{shareCopied ? "Copied" : "Copy link"}</span>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={handleShareToggle}
                className={`rounded-full px-2.5 py-1.5 text-[12px] font-medium sm:px-3.5 ${
                  isPublic
                    ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                    : "bg-white/[0.06] text-muted-foreground hover:bg-white/10 hover:text-foreground"
                }`}
              >
                {isPublic ? "Shared" : "Share"}
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="default"
            onClick={() => window.print()}
            title="Export PDF"
            className="gap-1.5 rounded-full bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-primary-foreground hover:bg-primary/80 sm:px-3.5"
          >
            <Printer className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export PDF</span>
          </Button>
        </div>
      </div>

      {canWrite && <GlobalToolbar editor={activeEditor} />}

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <div
            className="fixed inset-0 top-14 z-20 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div
          className={`fixed inset-y-14 left-0 z-30 flex w-64 flex-col border-r border-white/[0.06] bg-card transition-transform duration-200 md:static md:inset-y-auto md:z-auto md:w-56 md:translate-x-0 md:transition-none print:hidden ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
            {pages.map((page) => (
              <div
                key={page.id}
                onClick={() => scrollToPage(page.id)}
                className={`group flex items-center gap-1.5 rounded-lg px-2.5 py-2 cursor-pointer ${
                  page.id === activePageId
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:bg-white/5"
                }`}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{page.title}</span>
                {canWrite && pages.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeletePage(page.id);
                    }}
                    className="h-4 w-4 shrink-0 rounded text-muted-foreground opacity-0 hover:bg-transparent hover:text-destructive group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {canWrite && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => addPageMutation.mutate()}
              disabled={addPageMutation.isPending}
              className="justify-start gap-1.5 rounded-none border-t border-white/[0.06] px-3 py-2.5 text-[12.5px] text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Add page
            </Button>
          )}
        </div>

        {/* All pages render at once, stacked — a continuous scroll through
            the whole document, like scrolling through a Notion doc, instead
            of swapping one page's content in and out. Each page is its own
            document (created via "+ Add page" in the sidebar), styled as a
            Letter-proportioned sheet but growing naturally with content —
            actual pagination only happens at export/print time. */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-card px-3 py-6 sm:px-6 sm:py-10 print:overflow-visible print:bg-white print:p-0">
          <div className="mx-auto flex w-full max-w-[816px] flex-col gap-6 sm:gap-10 print:gap-0">
            {pages.map((page) => (
              <div key={page.id} className="print:break-after-page">
                <input
                  type="text"
                  value={page.title}
                  onChange={(e) => handlePageTitleChange(page.id, e.target.value)}
                  placeholder="Untitled"
                  disabled={!canWrite}
                  className="mb-2 w-full truncate bg-transparent text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground outline-none placeholder:text-muted-foreground focus:text-muted-foreground disabled:cursor-default print:hidden"
                />
                <PageSheet
                  page={page}
                  canWrite={canWrite}
                  registerRef={(el) => {
                    if (el) pageRefs.current.set(page.id, el);
                    else pageRefs.current.delete(page.id);
                  }}
                  onChange={(json) => handlePageContentChange(page.id, json)}
                  onFocusEditor={setActiveEditor}
                  slug={slug}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
