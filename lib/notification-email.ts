import { and, count, eq, gt, inArray, lt, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, emailOutbox, member, notificationPreferences, notifications, organization, user, type NotificationPayload } from "@/lib/db";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildNotificationEmail } from "@/lib/emails/notification";
import {
  createUnsubscribeToken,
  isEmailKind,
  notificationSettingsUrl,
  oneClickUnsubscribeUrl,
  unsubscribePageUrl,
  type EmailKind,
} from "@/lib/email-unsubscribe";

/**
 * Email delivery for notifications (issue #15 phase 3). Server-only, like
 * lib/notifications.ts: nothing here is a client-callable endpoint.
 *
 *   notify() inserts notifications → queueNotificationEmails() writes one
 *   outbox row each (unless that kind is switched off) → deliverOutbox() sends
 *   right away in after(); the daily cron retries what didn't go out.
 */

export const MAX_EMAIL_ATTEMPTS = 5;
export const MAX_EMAILS_PER_HOUR = 20;

export type SkipInput = {
  readAt: Date | null;
  emailEnabled: boolean;
  stillMember: boolean;
  sentInLastHour: number;
};

/** Why an email should NOT go out now, or null to send. Pure — the tests pin it. */
export function emailSkipReason(input: SkipInput): string | null {
  if (!input.emailEnabled) return "disabled";
  if (!input.stillMember) return "not_member";
  if (input.readAt) return "already_read";
  if (input.sentInLastHour >= MAX_EMAILS_PER_HOUR) return "hourly_cap";
  return null;
}

async function disabledKinds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: notificationPreferences.userId, kind: notificationPreferences.kind })
    .from(notificationPreferences)
    .where(and(inArray(notificationPreferences.userId, userIds), eq(notificationPreferences.emailEnabled, false)));
  return new Set(rows.map((r) => `${r.userId}:${r.kind}`));
}

/** One outbox row per freshly inserted notification whose kind emails and
 *  whose recipient hasn't switched that kind off. Returns the new row ids. */
export async function queueNotificationEmails(
  rows: { id: string; recipientId: string; kind: string }[],
): Promise<string[]> {
  const emailable = rows.filter((r) => isEmailKind(r.kind));
  if (emailable.length === 0) return [];
  const disabled = await disabledKinds([...new Set(emailable.map((r) => r.recipientId))]);
  const wanted = emailable.filter((r) => !disabled.has(`${r.recipientId}:${r.kind}`));
  if (wanted.length === 0) return [];

  const inserted = await db
    .insert(emailOutbox)
    .values(wanted.map((r) => ({ notificationId: r.id, recipientId: r.recipientId })))
    .onConflictDoNothing({ target: emailOutbox.notificationId })
    .returning({ id: emailOutbox.id });
  return inserted.map((r) => r.id);
}

type OutboxJob = {
  outboxId: string;
  attempts: number;
  recipientId: string;
  recipientEmail: string;
  kind: string;
  payload: NotificationPayload;
  readAt: Date | null;
  organizationId: string;
  workspaceName: string;
  actorName: string | null;
};

async function loadJobs(ids?: string[]): Promise<OutboxJob[]> {
  // The recipient and the actor are both `user` rows.
  const actor = alias(user, "actor");

  const rows = await db
    .select({
      outboxId: emailOutbox.id,
      attempts: emailOutbox.attempts,
      recipientId: emailOutbox.recipientId,
      recipientEmail: user.email,
      kind: notifications.kind,
      payload: notifications.payload,
      readAt: notifications.readAt,
      organizationId: notifications.organizationId,
      workspaceName: organization.name,
      actorName: actor.name,
    })
    .from(emailOutbox)
    .innerJoin(notifications, eq(notifications.id, emailOutbox.notificationId))
    .innerJoin(user, eq(user.id, emailOutbox.recipientId))
    .innerJoin(organization, eq(organization.id, notifications.organizationId))
    .leftJoin(actor, eq(actor.id, notifications.actorId))
    .where(
      and(
        ids ? inArray(emailOutbox.id, ids) : undefined,
        or(eq(emailOutbox.status, "pending"), eq(emailOutbox.status, "failed")),
        lt(emailOutbox.attempts, MAX_EMAIL_ATTEMPTS),
      ),
    )
    .limit(ids ? ids.length : 200);
  return rows;
}

async function isMember(organizationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  return Boolean(row);
}

async function sentInLastHour(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.recipientId, userId),
        eq(emailOutbox.status, "sent"),
        gt(emailOutbox.sentAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  return row?.value ?? 0;
}

async function deliverOne(job: OutboxJob): Promise<"sent" | "skipped" | "failed" | "pending"> {
  const kind = job.kind as EmailKind;
  const disabled = await disabledKinds([job.recipientId]);
  const reason = emailSkipReason({
    readAt: job.readAt,
    emailEnabled: isEmailKind(kind) && !disabled.has(`${job.recipientId}:${kind}`),
    stillMember: await isMember(job.organizationId, job.recipientId),
    sentInLastHour: await sentInLastHour(job.recipientId),
  });
  if (reason) {
    await db
      .update(emailOutbox)
      .set({ status: "skipped", skipReason: reason, updatedAt: new Date() })
      .where(eq(emailOutbox.id, job.outboxId));
    return "skipped";
  }

  // No key: leave it pending without burning an attempt — the cron sends it
  // once email is configured.
  if (!isEmailConfigured()) return "pending";

  const token = createUnsubscribeToken(job.recipientId, kind);
  const email = buildNotificationEmail({
    kind,
    actorName: job.actorName,
    workspaceName: job.workspaceName,
    title: job.payload.title,
    snippet: job.payload.snippet,
    href: job.payload.href,
    unsubscribeUrl: unsubscribePageUrl(token),
    settingsUrl: notificationSettingsUrl(),
  });

  try {
    await sendEmail({
      to: job.recipientEmail,
      ...email,
      headers: {
        "List-Unsubscribe": `<${oneClickUnsubscribeUrl(token)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      idempotencyKey: `notification-email/${job.outboxId}`,
    });
    await db
      .update(emailOutbox)
      .set({ status: "sent", sentAt: new Date(), attempts: job.attempts + 1, lastError: null, updatedAt: new Date() })
      .where(eq(emailOutbox.id, job.outboxId));
    return "sent";
  } catch (error) {
    await db
      .update(emailOutbox)
      .set({
        status: "failed",
        attempts: job.attempts + 1,
        lastError: String(error instanceof Error ? error.message : error).slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(emailOutbox.id, job.outboxId));
    return "failed";
  }
}

/** Send specific outbox rows (from after()) or, with no ids, everything still
 *  pending/failed under the attempt limit (the cron). Never throws. */
export async function deliverOutbox(ids?: string[]): Promise<Record<string, number>> {
  const tally: Record<string, number> = { sent: 0, skipped: 0, failed: 0, pending: 0 };
  try {
    if (ids && ids.length === 0) return tally;
    for (const job of await loadJobs(ids)) {
      tally[await deliverOne(job)] += 1;
    }
  } catch (error) {
    console.error("[notification-email] delivery run failed", error);
  }
  return tally;
}
