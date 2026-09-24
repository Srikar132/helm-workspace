"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useReactFlow, useViewport } from "@xyflow/react";
import { CircleCheck, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommentAvatar } from "@/components/canvas/comments/comment-avatar";
import { CommentBody } from "@/components/canvas/comments/comment-body";
import { CommentComposer } from "@/components/canvas/comments/comment-composer";
import { useCanvasComments } from "@/components/canvas/comments/canvas-comments-context";
import {
  deleteCommentAction,
  getCommentThreadAction,
  replyToThreadAction,
  updateCommentAction,
  type CommentItem,
  type ThreadDetail,
  type ThreadSummary,
} from "@/lib/actions/comments";
import { useSession } from "@/lib/auth-client";
import { commentThreadKey, commentThreadsKey } from "@/lib/query-keys";
import { unwrapAction } from "@/lib/query-utils";
import { timeAgo } from "@/lib/relative-time";
import { toastManager } from "@/lib/toast";
import { cn } from "@/lib/utils";

const PANEL_WIDTH = 360;
/** Hover-revealed row action; always shown on touch screens, which have no hover. */
const ROW_ACTION_CLASS =
  "ml-auto flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/comment:opacity-100 data-[popup-open]:opacity-100 pointer-coarse:opacity-100";
const EDGE = 12;
/** Roughly the pin bubble's footprint (screen px) — the panel sits beside it. */
const PIN_OFFSET = { x: 46, y: 40 };

// ── viewport-size + breakpoint, subscribed without effects ──────────────────
function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const readWidth = () => window.innerWidth;
const readHeight = () => window.innerHeight;
function useWindowSize() {
  const width = useSyncExternalStore(subscribeResize, readWidth, () => 1280);
  const height = useSyncExternalStore(subscribeResize, readHeight, () => 800);
  return { width, height };
}

/**
 * The open thread, or the composer for a pin that hasn't been posted yet.
 * Desktop: a card floating beside its pin, following it through pans and
 * zooms. Phone widths: a bottom sheet. Rendered into <body> so the canvas
 * transform never scales it.
 */
export function CommentThreadPanel() {
  const { openThreadId, draft } = useCanvasComments();
  if (!openThreadId && !draft) return null;
  return <PanelFrame key={openThreadId ?? "draft"} threadId={openThreadId} />;
}

function PanelFrame({ threadId }: { threadId: string | null }) {
  const comments = useCanvasComments();
  const { draft, threads, openThread, cancelDraft } = comments;
  const { flowToScreenPosition } = useReactFlow();
  // Re-render on every pan/zoom so the card tracks its pin.
  useViewport();
  const { width, height } = useWindowSize();
  const panelRef = useRef<HTMLDivElement>(null);

  const summary = threadId ? threads.find((t) => t.id === threadId) : undefined;
  const anchor = draft ?? (summary ? { x: summary.x, y: summary.y } : null);
  const isSheet = width < 640;

  const close = () => (draft ? cancelDraft() : openThread(null));

  // Outside press closes an open thread (never a draft — that would throw away
  // what was typed). Presses on pins, the @ picker and menus don't count.
  useEffect(() => {
    if (draft) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (!target || panelRef.current?.contains(target)) return;
      if (target.closest("[data-comment-pin], .react-renderer, [data-slot='dropdown-menu-content']")) return;
      openThread(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") openThread(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [draft, openThread]);

  if (!anchor) return null;

  const content = threadId ? (
    <ThreadView threadId={threadId} summary={summary} onClose={close} />
  ) : (
    <DraftView onClose={close} />
  );

  if (isSheet) {
    return createPortal(
      <>
        <div aria-hidden className="fixed inset-0 z-40 bg-background/40 backdrop-blur-[2px]" onPointerDown={close} />
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Comment thread"
          className="fixed inset-x-0 bottom-0 z-40 flex max-h-[78dvh] flex-col rounded-t-[22px] border-t border-border bg-popover text-popover-foreground shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-200"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
          {content}
        </div>
      </>,
      document.body,
    );
  }

  const pin = flowToScreenPosition(anchor);
  const maxHeight = Math.min(540, height - EDGE * 2);
  const fitsRight = pin.x + PIN_OFFSET.x + PANEL_WIDTH + EDGE <= width;
  const left = fitsRight ? pin.x + PIN_OFFSET.x : Math.max(EDGE, pin.x - PANEL_WIDTH - EDGE);
  const top = Math.min(Math.max(EDGE, pin.y - PIN_OFFSET.y), height - maxHeight - EDGE);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Comment thread"
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden rounded-[20px] border border-border bg-popover text-popover-foreground",
        "shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150",
      )}
      style={{
        left,
        top: Math.max(EDGE, top),
        width: PANEL_WIDTH,
        maxHeight,
        transformOrigin: fitsRight ? "0 0" : "100% 0",
      }}
    >
      {content}
    </div>,
    document.body,
  );
}

function PanelHeader({ title, children, onClose }: { title: ReactNode; children?: ReactNode; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 px-4 pb-2 pt-3">
      <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</div>
      {children}
      <IconButton label="Close" onClick={onClose}>
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "text-primary hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

// ── draft: the first comment of a new pin ────────────────────────────────────
function DraftView({ onClose }: { onClose: () => void }) {
  const { slug, draft, createThread, creating } = useCanvasComments();
  return (
    <>
      <PanelHeader title="New comment" onClose={onClose} />
      <div className="px-3 pb-3">
        <CommentComposer
          slug={slug}
          placeholder="Add a comment. Type @ to mention someone"
          submitLabel="Post comment"
          autoFocus
          pending={creating}
          onCancel={onClose}
          onSubmit={(body) => draft && createThread({ x: draft.x, y: draft.y, body })}
        />
        <p className="mt-2 px-1 text-[11.5px] text-muted-foreground">Enter to post, Shift+Enter for a new line.</p>
      </div>
    </>
  );
}

// ── an existing thread ───────────────────────────────────────────────────────
function ThreadView({
  threadId,
  summary,
  onClose,
}: {
  threadId: string;
  summary?: ThreadSummary;
  onClose: () => void;
}) {
  const api = useCanvasComments();
  const { slug, config, setResolved, deleteThread } = api;
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const key = commentThreadKey(threadId);

  const { data, isPending, error } = useQuery({
    queryKey: key,
    queryFn: () => getCommentThreadAction(threadId),
  });

  const thread = summary ?? data?.thread;
  // The thread list is what Resolve/Reopen patch optimistically, so it wins
  // over the (possibly older) detail fetch — reading the detail here is what
  // made Reopen show as "Resolve" and do nothing.
  const resolved = summary?.resolved ?? data?.thread.resolved ?? false;
  const canDeleteThread = Boolean(thread && (thread.authorId === config.viewerUserId || config.canModerate));
  const listRef = useRef<HTMLDivElement>(null);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: commentThreadsKey(slug) });
  };

  const { mutate: reply, isPending: replying } = useMutation({
    mutationFn: (body: Record<string, unknown>) => unwrapAction(replyToThreadAction(threadId, body)),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ThreadDetail | null>(key);
      const optimistic: CommentItem = {
        id: `pending-${Date.now()}`,
        authorId: config.viewerUserId,
        authorName: session?.user.name ?? "You",
        authorImage: session?.user.image ?? null,
        body,
        edited: false,
        deleted: false,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData<ThreadDetail | null>(key, (old) =>
        old ? { thread: { ...old.thread, resolved: false }, comments: [...old.comments, optimistic] } : old,
      );
      api.patchThread(threadId, { resolved: false, replyCount: (thread?.replyCount ?? 0) + 1 });
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
      return { previous };
    },
    onError: (err, _body, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
      toastManager.add({ title: "Reply not posted", description: err.message, type: "error" });
    },
    onSettled: refreshAll,
  });

  const { mutate: editComment, isPending: editing } = useMutation({
    mutationFn: (input: { commentId: string; body: Record<string, unknown> }) =>
      unwrapAction(updateCommentAction(input.commentId, input.body)),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ThreadDetail | null>(key);
      queryClient.setQueryData<ThreadDetail | null>(key, (old) =>
        old
          ? { ...old, comments: old.comments.map((c) => (c.id === input.commentId ? { ...c, body: input.body, edited: true } : c)) }
          : old,
      );
      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
      toastManager.add({ title: "Comment not saved", description: err.message, type: "error" });
    },
    onSettled: refreshAll,
  });

  const { mutate: removeComment } = useMutation({
    mutationFn: (commentId: string) => unwrapAction(deleteCommentAction(commentId)),
    onMutate: async (commentId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ThreadDetail | null>(key);
      queryClient.setQueryData<ThreadDetail | null>(key, (old) =>
        old
          ? {
              ...old,
              comments: old.comments.flatMap((c, i) =>
                c.id !== commentId ? [c] : i === 0 ? [{ ...c, body: null, deleted: true }] : [],
              ),
            }
          : old,
      );
      return { previous };
    },
    onSuccess: ({ threadDeleted }) => {
      if (threadDeleted) {
        queryClient.setQueryData<ThreadSummary[]>(commentThreadsKey(slug), (old) => old?.filter((t) => t.id !== threadId));
        onClose();
      }
    },
    onError: (err, _id, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
      toastManager.add({ title: "Comment not deleted", description: err.message, type: "error" });
    },
    onSettled: refreshAll,
  });

  const [editingId, setEditingId] = useState<string | null>(null);

  const replyCount = thread?.replyCount ?? 0;
  const title = resolved ? (
    <span className="inline-flex items-center gap-1.5">
      <CircleCheck className="h-3.5 w-3.5 text-primary" />
      Resolved
    </span>
  ) : replyCount > 0 ? (
    `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
  ) : (
    "Comment"
  );

  return (
    <>
      <PanelHeader title={title} onClose={onClose}>
        {config.canComment && !resolved && (
          <IconButton label="Resolve thread" onClick={() => setResolved({ threadId, resolved: true })}>
            <CircleCheck className="h-4 w-4" />
          </IconButton>
        )}
        {canDeleteThread && (
          <IconButton
            label="Delete thread"
            onClick={() => {
              if (window.confirm("Delete this whole thread for everyone?")) deleteThread(threadId);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
      </PanelHeader>

      {resolved && (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">Resolved. Hidden from the canvas until reopened.</span>
          {config.canComment && (
            <button
              type="button"
              onClick={() => setResolved({ threadId, resolved: false })}
              className="shrink-0 cursor-pointer rounded-full px-2 py-0.5 font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Reopen
            </button>
          )}
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1">
        {isPending && !data ? (
          <ThreadSkeleton />
        ) : error || data === null ? (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">
            This thread was deleted. Close it to get back to the canvas.
          </p>
        ) : (
          <ol className="pb-2">
            {data?.comments.map((comment, index) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                last={index === data.comments.length - 1}
                viewerUserId={config.viewerUserId}
                canModerate={config.canModerate}
                editing={editingId === comment.id}
                onEdit={() => setEditingId(comment.id)}
                onDelete={() => removeComment(comment.id)}
                editor={
                  <CommentComposer
                    slug={slug}
                    initialBody={comment.body ?? undefined}
                    submitLabel="Save"
                    autoFocus
                    pending={editing}
                    onCancel={() => setEditingId(null)}
                    onSubmit={(body) => {
                      editComment({ commentId: comment.id, body });
                      setEditingId(null);
                    }}
                  />
                }
              />
            ))}
          </ol>
        )}
      </div>

      {config.canComment && data && (
        <div className="shrink-0 border-t border-border px-3 py-3">
          <CommentComposer
            slug={slug}
            placeholder={resolved ? "Reply to reopen" : "Reply"}
            submitLabel="Post reply"
            pending={replying}
            onCancel={onClose}
            onSubmit={(body, clear) => {
              reply(body);
              clear();
            }}
          />
        </div>
      )}
    </>
  );
}

function CommentRow({
  comment,
  last,
  viewerUserId,
  canModerate,
  editing,
  onEdit,
  onDelete,
  editor,
}: {
  comment: CommentItem;
  last: boolean;
  viewerUserId: string;
  canModerate: boolean;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  editor: ReactNode;
}) {
  const own = comment.authorId === viewerUserId;
  const canEdit = own && !comment.deleted;
  const canDelete = (own || canModerate) && !comment.deleted;
  const pending = comment.id.startsWith("pending-");

  return (
    <li className={cn("group/comment relative flex gap-3 pt-3", pending && "opacity-70")}>
      {/* The reply line: joins each avatar to the next, so the chain reads as one conversation. */}
      {!last && <span aria-hidden className="absolute bottom-0 left-[13.5px] top-[44px] w-px bg-border" />}
      <CommentAvatar name={comment.authorName} image={comment.authorImage} className="relative h-7 w-7 text-[12px]" />
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium">{comment.authorName ?? "Deleted user"}</span>
          <time dateTime={comment.createdAt} className="shrink-0 text-[12px] text-muted-foreground">
            {pending ? "Sending" : timeAgo(comment.createdAt)}
          </time>
          {comment.edited && !comment.deleted && <span className="shrink-0 text-[12px] text-muted-foreground">(edited)</span>}
          {!pending && !editing && canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Edit or delete your comment"
                title="Edit or delete"
                className={ROW_ACTION_CLASS}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    if (window.confirm("Delete your comment?")) onDelete();
                  }}
                >
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!pending && !editing && !canEdit && canDelete && (
            <button
              type="button"
              aria-label={`Delete ${comment.authorName ?? "this"}'s comment`}
              title="Delete comment (workspace admin)"
              onClick={() => {
                if (window.confirm(`Delete ${comment.authorName ?? "this person"}'s comment for everyone?`)) onDelete();
              }}
              className={ROW_ACTION_CLASS}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="mt-0.5">
          {editing ? (
            editor
          ) : comment.deleted || !comment.body ? (
            <p className="text-[13px] italic text-muted-foreground">Comment deleted</p>
          ) : (
            <CommentBody body={comment.body} />
          )}
        </div>
      </div>
    </li>
  );
}

function ThreadSkeleton() {
  return (
    <div className="space-y-4 py-3" aria-label="Loading thread">
      {[0, 1].map((i) => (
        <div key={i} className="flex gap-3">
          <div className="h-7 w-7 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
