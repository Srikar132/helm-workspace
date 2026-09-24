import { docSnippet } from "@/lib/mentions";

/**
 * Pure rules for canvas comment threads — shared by the server actions and the
 * client, and the part the tests pin.
 */

export const MAX_COMMENT_TEXT = 5000;
export const MAX_COMMENT_JSON_BYTES = 64 * 1024;
export const MAX_OPEN_THREADS_PER_WORKSPACE = 200;
/** Canvas coordinates beyond this are a bug or an attack, not a real pan. */
export const MAX_CANVAS_COORD = 10_000_000;
/** Pointer travel (screen px) below which a press on a pin is a click, not a drag. */
export const PIN_DRAG_THRESHOLD_PX = 4;

export type CommentBodyCheck = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

/** Plain text of a comment (mention labels included as `@name`). */
export function commentPlainText(body: unknown): string {
  return docSnippet(body, MAX_COMMENT_TEXT + 1);
}

/** Server-side gate on a client-written comment body. The body is rendered by
 *  a read-only Tiptap editor, never as an HTML string, so this is about size
 *  and emptiness, not sanitising. */
export function validateCommentBody(body: unknown): CommentBodyCheck {
  if (!body || typeof body !== "object" || Array.isArray(body) || (body as { type?: unknown }).type !== "doc") {
    return { ok: false, error: "Invalid comment." };
  }
  if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_COMMENT_JSON_BYTES) {
    return { ok: false, error: "That comment is too large." };
  }
  const text = commentPlainText(body);
  if (text.length === 0) return { ok: false, error: "Write something first." };
  if (text.length > MAX_COMMENT_TEXT) {
    return { ok: false, error: `Keep comments under ${MAX_COMMENT_TEXT} characters.` };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

/**
 * Who hears about a new comment as a REPLY: the thread's author and everyone
 * who has commented in it before — minus the commenter, and minus anyone the
 * same comment mentions (they already get the mention; one notification per
 * person per comment).
 */
export function replyRecipients(input: {
  threadAuthorId: string | null;
  priorCommentAuthorIds: (string | null)[];
  actorId: string;
  mentionedIds: string[];
}): string[] {
  const skip = new Set([input.actorId, ...input.mentionedIds]);
  const out: string[] = [];
  for (const id of [input.threadAuthorId, ...input.priorCommentAuthorIds]) {
    if (!id || skip.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function isPinDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= PIN_DRAG_THRESHOLD_PX;
}
