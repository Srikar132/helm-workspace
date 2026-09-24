"use server";

import { z } from "zod";
import { and, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, member, notifications, organization, user, type NotificationPayload } from "@/lib/db";
import { requireViewerContext } from "@/lib/workspace";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * The viewer's own notifications, across every workspace they are STILL a
 * member of — the inner join on `member` is the privacy check: leave a
 * workspace and its notifications vanish from the bell (the rows stay, so
 * rejoining brings them back). Every query filters on the viewer's own user id,
 * so another user's notification id is indistinguishable from a missing one.
 */

const PAGE_SIZE = 20;

export type NotificationItem = {
  id: string;
  kind: string;
  actorName: string | null;
  actorImage: string | null;
  workspaceName: string;
  payload: NotificationPayload;
  read: boolean;
  createdAt: string;
};

export type NotificationPage = { items: NotificationItem[]; nextCursor: string | null };

// Cursor = "<createdAt ISO>|<id>" of the last row — (createdAt, id) is the
// sort, so ties on the timestamp still page deterministically.
const cursorSchema = z
  .string()
  .regex(/^[^|]+\|[0-9a-f-]{36}$/i)
  .transform((raw) => {
    const [at, id] = raw.split("|");
    return { at: new Date(at), id };
  })
  .refine((c) => !Number.isNaN(c.at.getTime()));

function visibleTo(userId: string) {
  return and(eq(notifications.recipientId, userId), eq(member.userId, userId));
}

export async function listNotificationsAction(cursor?: string | null): Promise<NotificationPage> {
  const viewer = await requireViewerContext();
  const parsedCursor = cursor ? cursorSchema.safeParse(cursor) : null;
  const cursorAfter = parsedCursor?.success ? parsedCursor.data : null;

  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      payload: notifications.payload,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      workspaceName: organization.name,
      actorName: user.name,
      actorImage: user.image,
    })
    .from(notifications)
    .innerJoin(
      member,
      and(eq(member.organizationId, notifications.organizationId), eq(member.userId, notifications.recipientId)),
    )
    .innerJoin(organization, eq(organization.id, notifications.organizationId))
    .leftJoin(user, eq(user.id, notifications.actorId))
    .where(
      and(
        visibleTo(viewer.userId),
        cursorAfter
          ? or(
              lt(notifications.createdAt, cursorAfter.at),
              and(eq(notifications.createdAt, cursorAfter.at), lt(notifications.id, cursorAfter.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      actorName: row.actorName,
      actorImage: row.actorImage,
      workspaceName: row.workspaceName,
      payload: row.payload,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
  };
}

export async function getUnreadNotificationCountAction(): Promise<number> {
  const viewer = await requireViewerContext();
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .innerJoin(
      member,
      and(eq(member.organizationId, notifications.organizationId), eq(member.userId, notifications.recipientId)),
    )
    .where(and(visibleTo(viewer.userId), isNull(notifications.readAt)));
  return row?.value ?? 0;
}

const markReadSchema = z.union([z.literal("all"), z.array(z.uuid()).min(1).max(100)]);

export async function markNotificationsReadAction(ids: string[] | "all"): Promise<{ error?: string }> {
  const parsed = markReadSchema.safeParse(ids);
  if (!parsed.success) return { error: "Invalid notification ids." };

  const viewer = await requireViewerContext();
  const rateLimit = await checkRateLimit(`notifications-read:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientId, viewer.userId),
        isNull(notifications.readAt),
        parsed.data === "all" ? undefined : inArray(notifications.id, parsed.data),
      ),
    );
  return {};
}
