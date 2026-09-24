"use server";

import { after } from "next/server";
import { z } from "zod";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { commentThreads, comments, db, user } from "@/lib/db";
import { requireViewerContext, type ViewerContext } from "@/lib/workspace";
import { canComment, canModerateComments } from "@/lib/permissions";
import { checkDragRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { extractMentionIds, diffMentions } from "@/lib/mentions";
import {
  MAX_CANVAS_COORD,
  MAX_OPEN_THREADS_PER_WORKSPACE,
  commentPlainText,
  replyRecipients,
  validateCommentBody,
} from "@/lib/comments";
import {
  commentMentionDedupeKey,
  commentReplyDedupeKey,
  notify,
  notifyNewMentions,
  threadHref,
} from "@/lib/notifications";

/**
 * Canvas comment threads. Every query is scoped to the viewer's workspace and
 * to live rows, so a thread or comment id from anywhere else is
 * indistinguishable from one that doesn't exist. Commenting is gated by
 * canComment (view-only members included); editing is author-only, enforced
 * in the UPDATE's WHERE; deleting/moving someone else's is canModerateComments.
 */

export type ThreadSummary = {
  id: string;
  x: number;
  y: number;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  resolved: boolean;
  /** Live comments after the first. */
  replyCount: number;
  /** Plain-text opening of the thread, for the pin's hover preview. */
  preview: string;
  createdAt: string;
};

export type CommentItem = {
  id: string;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  /** Null for the placeholder of a deleted opening comment. */
  body: Record<string, unknown> | null;
  edited: boolean;
  deleted: boolean;
  createdAt: string;
};

export type ThreadDetail = { thread: ThreadSummary; comments: CommentItem[] };

/** The repo's action convention: `{ error }` on failure, never a throw. */
type Result<T = object> = { error?: string } & Partial<T>;

const PREVIEW_LENGTH = 90;
const NOT_FOUND = "That comment thread no longer exists.";
const COMMENT_NOT_FOUND = "That comment no longer exists.";
const NO_ACCESS = "You can't comment in this workspace.";

const idSchema = z.uuid();
const coordSchema = z.number().int().min(-MAX_CANVAS_COORD).max(MAX_CANVAS_COORD);
const bodySchema = z.record(z.string(), z.unknown());

const liveCommentCount = sql<number>`(
  select count(*) from ${comments}
  where ${comments.threadId} = ${commentThreads.id} and ${comments.deletedAt} is null
)`.mapWith(Number);

function threadWhere(threadId: string, organizationId: string) {
  return and(
    eq(commentThreads.id, threadId),
    eq(commentThreads.organizationId, organizationId),
    isNull(commentThreads.deletedAt),
  );
}

async function selectThreads(organizationId: string, threadId?: string): Promise<ThreadSummary[]> {
  const rows = await db
    .select({
      id: commentThreads.id,
      x: commentThreads.x,
      y: commentThreads.y,
      authorId: commentThreads.authorId,
      authorName: user.name,
      authorImage: user.image,
      resolvedAt: commentThreads.resolvedAt,
      commentCount: liveCommentCount,
      createdAt: commentThreads.createdAt,
    })
    .from(commentThreads)
    .leftJoin(user, eq(user.id, commentThreads.authorId))
    .where(
      threadId
        ? threadWhere(threadId, organizationId)
        : and(eq(commentThreads.organizationId, organizationId), isNull(commentThreads.deletedAt)),
    )
    .orderBy(asc(commentThreads.createdAt));
  if (rows.length === 0) return [];

  // First live comment per thread, in one DISTINCT ON query.
  const firsts = await db
    .selectDistinctOn([comments.threadId], { threadId: comments.threadId, body: comments.body })
    .from(comments)
    .where(
      and(
        eq(comments.organizationId, organizationId),
        isNull(comments.deletedAt),
        threadId ? eq(comments.threadId, threadId) : undefined,
      ),
    )
    .orderBy(comments.threadId, asc(comments.createdAt), asc(comments.id));
  const previews = new Map(firsts.map((f) => [f.threadId, commentPlainText(f.body).slice(0, PREVIEW_LENGTH)]));

  return rows.map((row) => ({
    id: row.id,
    x: row.x,
    y: row.y,
    authorId: row.authorId,
    authorName: row.authorName,
    authorImage: row.authorImage,
    resolved: row.resolvedAt !== null,
    replyCount: Math.max(0, row.commentCount - 1),
    preview: previews.get(row.id) ?? "",
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Every live thread in the active workspace, resolved ones included — the
 *  client decides whether to show those. */
export async function listCommentThreadsAction(): Promise<ThreadSummary[]> {
  const viewer = await requireViewerContext();
  return selectThreads(viewer.organizationId);
}

export async function getCommentThreadAction(threadId: string): Promise<ThreadDetail | null> {
  const parsed = idSchema.safeParse(threadId);
  if (!parsed.success) return null;
  const viewer = await requireViewerContext();

  const [thread] = await selectThreads(viewer.organizationId, parsed.data);
  if (!thread) return null;

  const rows = await db
    .select({
      id: comments.id,
      authorId: comments.authorId,
      authorName: user.name,
      authorImage: user.image,
      body: comments.body,
      editedAt: comments.editedAt,
      deletedAt: comments.deletedAt,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.authorId))
    .where(and(eq(comments.threadId, thread.id), eq(comments.organizationId, viewer.organizationId)))
    .orderBy(asc(comments.createdAt), asc(comments.id));

  // Deleted replies vanish; a deleted OPENING comment stays as a placeholder
  // so the replies under it still read as a conversation.
  const items: CommentItem[] = [];
  rows.forEach((row, index) => {
    const deleted = row.deletedAt !== null;
    if (deleted && index > 0) return;
    items.push({
      id: row.id,
      authorId: row.authorId,
      authorName: row.authorName,
      authorImage: row.authorImage,
      body: deleted ? null : row.body,
      edited: row.editedAt !== null,
      deleted,
      createdAt: row.createdAt.toISOString(),
    });
  });

  return { thread, comments: items };
}

async function guardWrite(
  viewer: ViewerContext,
  limiter: "action" | "drag" = "action",
): Promise<string | null> {
  if (!canComment(viewer.role)) return NO_ACCESS;
  const rateLimit =
    limiter === "drag"
      ? await checkDragRateLimit(`comment-move:${viewer.userId}`)
      : await checkRateLimit(`comment:${viewer.userId}`);
  return rateLimit.success ? null : (rateLimit.error ?? "Too many requests.");
}

/** Mention + reply notifications for a freshly posted comment. */
function notifyForNewComment(input: {
  viewer: ViewerContext;
  threadId: string;
  commentId: string;
  body: Record<string, unknown>;
  replyTo?: { threadAuthorId: string | null; priorCommentAuthorIds: (string | null)[] };
}) {
  const { viewer, threadId, commentId, body, replyTo } = input;
  const mentioned = extractMentionIds(body);
  const snippet = commentPlainText(body).slice(0, 140);
  const payload = (slug: string) => ({ href: threadHref(slug, threadId), title: "a comment", ...(snippet ? { snippet } : {}) });

  after(async () => {
    await notify({
      organizationId: viewer.organizationId,
      actorType: "user",
      actorId: viewer.userId,
      kind: "mention",
      sourceType: "comment_thread",
      sourceId: threadId,
      recipientIds: mentioned,
      payload,
      dedupeKey: (recipientId) => commentMentionDedupeKey(commentId, recipientId),
    });
    if (!replyTo) return;
    await notify({
      organizationId: viewer.organizationId,
      actorType: "user",
      actorId: viewer.userId,
      kind: "comment_reply",
      sourceType: "comment_thread",
      sourceId: threadId,
      recipientIds: replyRecipients({ ...replyTo, actorId: viewer.userId, mentionedIds: mentioned }),
      payload,
      dedupeKey: (recipientId) => commentReplyDedupeKey(commentId, recipientId),
    });
  });
}

const createThreadSchema = z.object({ x: coordSchema, y: coordSchema, body: bodySchema });

export async function createCommentThreadAction(
  input: z.infer<typeof createThreadSchema>,
): Promise<Result<{ thread: ThreadSummary }>> {
  const parsed = createThreadSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid comment." };
  const checked = validateCommentBody(parsed.data.body);
  if (!checked.ok) return { error: checked.error };

  const viewer = await requireViewerContext();
  const denied = await guardWrite(viewer);
  if (denied) return { error: denied };

  const [{ value: open }] = await db
    .select({ value: count() })
    .from(commentThreads)
    .where(
      and(
        eq(commentThreads.organizationId, viewer.organizationId),
        isNull(commentThreads.deletedAt),
        isNull(commentThreads.resolvedAt),
      ),
    );
  if (open >= MAX_OPEN_THREADS_PER_WORKSPACE) {
    return { error: "This workspace has too many open comments — resolve some first." };
  }

  const [thread] = await db
    .insert(commentThreads)
    .values({ organizationId: viewer.organizationId, authorId: viewer.userId, x: parsed.data.x, y: parsed.data.y })
    .returning({ id: commentThreads.id, createdAt: commentThreads.createdAt });

  // No transactions on Neon HTTP: if the opening comment can't be written,
  // take the thread back down rather than leave an empty pin on the canvas.
  let commentId: string;
  try {
    const [comment] = await db
      .insert(comments)
      .values({ threadId: thread.id, organizationId: viewer.organizationId, authorId: viewer.userId, body: checked.body })
      .returning({ id: comments.id });
    commentId = comment.id;
  } catch (error) {
    console.error("[comments] opening comment failed", error);
    await db.update(commentThreads).set({ deletedAt: new Date() }).where(eq(commentThreads.id, thread.id));
    return { error: "Couldn't post that comment. Try again." };
  }

  notifyForNewComment({ viewer, threadId: thread.id, commentId, body: checked.body });

  return {
    thread: {
      id: thread.id,
      x: parsed.data.x,
      y: parsed.data.y,
      authorId: viewer.userId,
      authorName: viewer.userName,
      authorImage: null,
      resolved: false,
      replyCount: 0,
      preview: commentPlainText(checked.body).slice(0, PREVIEW_LENGTH),
      createdAt: thread.createdAt.toISOString(),
    },
  };
}

export async function replyToThreadAction(threadId: string, body: Record<string, unknown>): Promise<Result<{ commentId: string }>> {
  const parsedId = idSchema.safeParse(threadId);
  if (!parsedId.success) return { error: NOT_FOUND };
  const checked = validateCommentBody(body);
  if (!checked.ok) return { error: checked.error };

  const viewer = await requireViewerContext();
  const denied = await guardWrite(viewer);
  if (denied) return { error: denied };

  const [thread] = await db
    .select({ id: commentThreads.id, authorId: commentThreads.authorId, resolvedAt: commentThreads.resolvedAt })
    .from(commentThreads)
    .where(threadWhere(parsedId.data, viewer.organizationId))
    .limit(1);
  if (!thread) return { error: NOT_FOUND };

  const prior = await db
    .selectDistinct({ authorId: comments.authorId })
    .from(comments)
    .where(and(eq(comments.threadId, thread.id), isNull(comments.deletedAt)));

  const [comment] = await db
    .insert(comments)
    .values({ threadId: thread.id, organizationId: viewer.organizationId, authorId: viewer.userId, body: checked.body })
    .returning({ id: comments.id });

  // A reply is someone reopening the conversation.
  await db
    .update(commentThreads)
    .set({ updatedAt: new Date(), ...(thread.resolvedAt ? { resolvedAt: null, resolvedBy: null } : {}) })
    .where(eq(commentThreads.id, thread.id));

  notifyForNewComment({
    viewer,
    threadId: thread.id,
    commentId: comment.id,
    body: checked.body,
    replyTo: { threadAuthorId: thread.authorId, priorCommentAuthorIds: prior.map((p) => p.authorId) },
  });

  return { commentId: comment.id };
}

export async function updateCommentAction(commentId: string, body: Record<string, unknown>): Promise<Result> {
  const parsedId = idSchema.safeParse(commentId);
  if (!parsedId.success) return { error: COMMENT_NOT_FOUND };
  const checked = validateCommentBody(body);
  if (!checked.ok) return { error: checked.error };

  const viewer = await requireViewerContext();
  const denied = await guardWrite(viewer);
  if (denied) return { error: denied };

  // Author-only is part of the WHERE, not a pre-check — someone else's
  // comment id simply matches nothing.
  const own = and(
    eq(comments.id, parsedId.data),
    eq(comments.organizationId, viewer.organizationId),
    eq(comments.authorId, viewer.userId),
    isNull(comments.deletedAt),
  );
  const [before] = await db.select({ threadId: comments.threadId, body: comments.body }).from(comments).where(own).limit(1);
  if (!before) return { error: COMMENT_NOT_FOUND };

  const updated = await db
    .update(comments)
    .set({ body: checked.body, editedAt: new Date() })
    .where(own)
    .returning({ id: comments.id });
  if (updated.length === 0) return { error: COMMENT_NOT_FOUND };

  if (diffMentions(before.body, checked.body).length > 0) {
    const threadId = before.threadId;
    after(() =>
      notifyNewMentions({
        organizationId: viewer.organizationId,
        actorId: viewer.userId,
        sourceType: "comment_thread",
        sourceId: threadId,
        prev: before.body,
        next: checked.body,
        title: "a comment",
        href: (slug) => threadHref(slug, threadId),
        dedupeKey: (recipientId) => commentMentionDedupeKey(parsedId.data, recipientId),
      }),
    );
  }
  return {};
}

export async function deleteCommentAction(commentId: string): Promise<Result<{ threadDeleted: boolean }>> {
  const parsedId = idSchema.safeParse(commentId);
  if (!parsedId.success) return { error: COMMENT_NOT_FOUND };

  const viewer = await requireViewerContext();
  const denied = await guardWrite(viewer);
  if (denied) return { error: denied };

  const mayModerate = canModerateComments(viewer.role);
  const deleted = await db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(comments.id, parsedId.data),
        eq(comments.organizationId, viewer.organizationId),
        isNull(comments.deletedAt),
        mayModerate ? undefined : eq(comments.authorId, viewer.userId),
      ),
    )
    .returning({ threadId: comments.threadId });
  if (deleted.length === 0) return { error: COMMENT_NOT_FOUND };

  // Last live comment gone → the pin goes too.
  const threadId = deleted[0].threadId;
  const [{ value: remaining }] = await db
    .select({ value: count() })
    .from(comments)
    .where(and(eq(comments.threadId, threadId), isNull(comments.deletedAt)));
  if (remaining === 0) {
    await db.update(commentThreads).set({ deletedAt: new Date() }).where(eq(commentThreads.id, threadId));
    return { threadDeleted: true };
  }
  return { threadDeleted: false };
}

export async function setThreadResolvedAction(threadId: string, resolved: boolean): Promise<Result> {
  const parsedId = idSchema.safeParse(threadId);
  if (!parsedId.success) return { error: NOT_FOUND };

  const viewer = await requireViewerContext();
  const denied = await guardWrite(viewer);
  if (denied) return { error: denied };

  const updated = await db
    .update(commentThreads)
    .set(
      resolved
        ? { resolvedAt: new Date(), resolvedBy: viewer.userId, updatedAt: new Date() }
        : { resolvedAt: null, resolvedBy: null, updatedAt: new Date() },
    )
    .where(threadWhere(parsedId.data, viewer.organizationId))
    .returning({ id: commentThreads.id });
  return updated.length === 0 ? { error: NOT_FOUND } : {};
}

function ownOrModerated(viewer: ViewerContext) {
  return canModerateComments(viewer.role) ? undefined : eq(commentThreads.authorId, viewer.userId);
}

const moveSchema = z.object({ threadId: idSchema, x: coordSchema, y: coordSchema });

export async function moveCommentThreadAction(input: z.infer<typeof moveSchema>): Promise<Result> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: NOT_FOUND };

  const viewer = await requireViewerContext();
  const denied = await guardWrite(viewer, "drag");
  if (denied) return { error: denied };

  const updated = await db
    .update(commentThreads)
    .set({ x: parsed.data.x, y: parsed.data.y, updatedAt: new Date() })
    .where(and(threadWhere(parsed.data.threadId, viewer.organizationId), ownOrModerated(viewer)))
    .returning({ id: commentThreads.id });
  return updated.length === 0 ? { error: "You can only move your own comments." } : {};
}

export async function deleteCommentThreadAction(threadId: string): Promise<Result> {
  const parsedId = idSchema.safeParse(threadId);
  if (!parsedId.success) return { error: NOT_FOUND };

  const viewer = await requireViewerContext();
  const denied = await guardWrite(viewer);
  if (denied) return { error: denied };

  const updated = await db
    .update(commentThreads)
    .set({ deletedAt: new Date() })
    .where(and(threadWhere(parsedId.data, viewer.organizationId), ownOrModerated(viewer)))
    .returning({ id: commentThreads.id });
  return updated.length === 0 ? { error: "You can only delete your own comments." } : {};
}
