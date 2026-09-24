"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, notificationPreferences } from "@/lib/db";
import { requireViewerContext } from "@/lib/workspace";
import { checkRateLimit } from "@/lib/rate-limit";
import { EMAIL_KINDS, isEmailKind, verifyUnsubscribeToken, type EmailKind } from "@/lib/email-unsubscribe";

/** Email on/off per kind. A kind with no row is ON — the default the user chose. */
export type EmailPreferences = Record<EmailKind, boolean>;

async function readPreferences(userId: string): Promise<EmailPreferences> {
  const rows = await db
    .select({ kind: notificationPreferences.kind, emailEnabled: notificationPreferences.emailEnabled })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const prefs = Object.fromEntries(EMAIL_KINDS.map((k) => [k, true])) as EmailPreferences;
  for (const row of rows) if (isEmailKind(row.kind)) prefs[row.kind] = row.emailEnabled;
  return prefs;
}

async function writePreference(userId: string, kind: EmailKind, emailEnabled: boolean) {
  await db
    .insert(notificationPreferences)
    .values({ userId, kind, emailEnabled })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.kind],
      set: { emailEnabled, updatedAt: new Date() },
    });
}

export async function getNotificationPreferencesAction(): Promise<EmailPreferences> {
  const viewer = await requireViewerContext();
  return readPreferences(viewer.userId);
}

const setSchema = z.object({ kind: z.enum(EMAIL_KINDS), enabled: z.boolean() });

export async function setEmailPreferenceAction(input: z.infer<typeof setSchema>): Promise<{ error?: string }> {
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid setting." };
  const viewer = await requireViewerContext();
  const rateLimit = await checkRateLimit(`notification-prefs:${viewer.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };
  await writePreference(viewer.userId, parsed.data.kind, parsed.data.enabled);
  return {};
}

/**
 * The unsubscribe page's button. No session on purpose — the link has to work
 * from any inbox — so the signed token IS the authorization, and all it can
 * ever do is switch one kind OFF for the user it was issued to.
 */
export async function unsubscribeWithTokenAction(token: string): Promise<{ error?: string; kind?: EmailKind }> {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return { error: "This unsubscribe link isn't valid." };
  const rateLimit = await checkRateLimit(`unsubscribe:${verified.userId}`);
  if (!rateLimit.success) return { error: rateLimit.error };
  await writePreference(verified.userId, verified.kind, false);
  return { kind: verified.kind };
}

/** What an unsubscribe link would do, for the confirm page. Token-checked,
 *  like the action above — never takes a raw user id from the caller. */
export async function getUnsubscribeStatusAction(
  token: string,
): Promise<{ valid: false } | { valid: true; kind: EmailKind; alreadyOff: boolean }> {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return { valid: false };
  const [row] = await db
    .select({ emailEnabled: notificationPreferences.emailEnabled })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, verified.userId), eq(notificationPreferences.kind, verified.kind)))
    .limit(1);
  return { valid: true, kind: verified.kind, alreadyOff: row ? !row.emailEnabled : false };
}
