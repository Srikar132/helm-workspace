import { and, eq, inArray } from "drizzle-orm";
import { db, member, notifications, organization, type NotificationPayload } from "@/lib/db";
import { diffMentions, docSnippet } from "@/lib/mentions";

/**
 * The ONE place a notification row is written. Note/doc mentions and canvas
 * comment threads call it today; AI/system alerts later call it unchanged —
 * only the unions below grow.
 *
 * Deliberately NOT a "use server" module: exported functions there become
 * client-callable endpoints, and this one takes arbitrary recipient ids. Only
 * server actions import it, after they have resolved identity, scoped to the
 * viewer's organization and passed their own write check.
 */

export type NotificationActorType = "user" | "system" | "ai";
export type NotificationKind = "mention" | "comment_reply";
export type NotificationSourceType = "widget" | "doc_page" | "comment_thread";

/** Fan-out cap per call — a pasted wall of mentions notifies the first 20. */
export const MAX_RECIPIENTS_PER_NOTIFY = 20;

export type NotifyInput = {
  organizationId: string;
  actorType: NotificationActorType;
  actorId: string | null;
  kind: NotificationKind;
  sourceType: NotificationSourceType;
  sourceId: string;
  recipientIds: string[];
  /** Built once the workspace slug is known, so every href is server-made. */
  payload: (workspaceSlug: string) => NotificationPayload;
  /** Idempotency key per recipient — each caller owns what "the same
   *  notification" means (per source for note mentions, per comment for
   *  comment mentions and replies). */
  dedupeKey: (recipientId: string) => string;
};

export function mentionDedupeKey(sourceType: NotificationSourceType, sourceId: string, recipientId: string) {
  return `mention:${sourceType}:${sourceId}:${recipientId}`;
}

/** One per comment per recipient — a reply is a new comment, so it notifies again. */
export function commentMentionDedupeKey(commentId: string, recipientId: string) {
  return `mention:comment:${commentId}:${recipientId}`;
}

export function commentReplyDedupeKey(commentId: string, recipientId: string) {
  return `reply:comment:${commentId}:${recipientId}`;
}

export function threadHref(workspaceSlug: string, threadId: string) {
  return `/workspace/${encodeURIComponent(workspaceSlug)}?thread=${encodeURIComponent(threadId)}`;
}

export function widgetHref(workspaceSlug: string, widgetId: string) {
  return `/workspace/${encodeURIComponent(workspaceSlug)}?focus=${encodeURIComponent(widgetId)}`;
}

export function docPageHref(workspaceSlug: string, docProjectId: string, pageId: string) {
  return `/workspace/${encodeURIComponent(workspaceSlug)}/docs/${encodeURIComponent(docProjectId)}?page=${encodeURIComponent(pageId)}`;
}

/** Unique, non-empty, not the actor, capped. Pure — exported for tests. */
export function candidateRecipients(recipientIds: string[], actorId: string | null): string[] {
  const out: string[] = [];
  for (const id of recipientIds) {
    if (!id || id === actorId || out.includes(id)) continue;
    out.push(id);
    if (out.length === MAX_RECIPIENTS_PER_NOTIFY) break;
  }
  return out;
}

/**
 * Writes one row per recipient who is CURRENTLY a member of the organization.
 * Unknown, removed and deleted users are dropped silently. Idempotent through
 * the dedupe key. Never throws — a notification must not fail the write that
 * caused it; callers run this in `after()`.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const candidates = candidateRecipients(input.recipientIds, input.actorId);
    if (candidates.length === 0) return;

    const rows = await db
      .select({ userId: member.userId, slug: organization.slug })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.organizationId, input.organizationId), inArray(member.userId, candidates)));
    if (rows.length === 0) return;

    const payload = input.payload(rows[0].slug);
    await db
      .insert(notifications)
      .values(
        rows.map((row) => ({
          organizationId: input.organizationId,
          recipientId: row.userId,
          actorType: input.actorType,
          actorId: input.actorId,
          kind: input.kind,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          payload,
          dedupeKey: input.dedupeKey(row.userId),
        })),
      )
      .onConflictDoNothing({ target: notifications.dedupeKey });
  } catch (error) {
    console.error("[notifications] notify failed", error);
  }
}

/** Notify everyone a save newly mentions. `prev`/`next` are ProseMirror JSON. */
export async function notifyNewMentions(input: {
  organizationId: string;
  actorId: string;
  sourceType: NotificationSourceType;
  sourceId: string;
  prev: unknown;
  next: unknown;
  title: string;
  href: (workspaceSlug: string) => string;
  /** Defaults to one mention notification per person per source. */
  dedupeKey?: (recipientId: string) => string;
}): Promise<void> {
  const added = diffMentions(input.prev, input.next);
  if (added.length === 0) return;
  const snippet = docSnippet(input.next);
  await notify({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorId,
    kind: "mention",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    recipientIds: added,
    payload: (slug) => ({ href: input.href(slug), title: input.title, ...(snippet ? { snippet } : {}) }),
    dedupeKey: input.dedupeKey ?? ((recipientId) => mentionDedupeKey(input.sourceType, input.sourceId, recipientId)),
  });
}
