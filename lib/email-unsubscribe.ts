import { createHmac, timingSafeEqual } from "node:crypto";
import { appOrigin } from "@/lib/emails/invitation";

/**
 * Signed one-click unsubscribe tokens for notification email.
 *
 * A token is `base64url(userId + "\n" + kind) . base64url(HMAC)` and grants
 * exactly one thing: turning OFF email for that kind, for that user. No
 * expiry — an unsubscribe link has to keep working in an old email. The key
 * is derived from BETTER_AUTH_SECRET with its own label, so there's no extra
 * secret to manage and it can't be confused with any auth signature.
 */

export const EMAIL_KINDS = ["mention", "comment_reply"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export function isEmailKind(value: unknown): value is EmailKind {
  return typeof value === "string" && (EMAIL_KINDS as readonly string[]).includes(value);
}

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  mention: "mention emails",
  comment_reply: "reply emails",
};

function signingKey(secret = process.env.BETTER_AUTH_SECRET): Buffer {
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to sign unsubscribe links.");
  return createHmac("sha256", secret).update("email-unsubscribe:v1").digest();
}

function mac(payload: string, secret?: string): Buffer {
  return createHmac("sha256", signingKey(secret)).update(payload).digest();
}

export function createUnsubscribeToken(userId: string, kind: EmailKind, secret?: string): string {
  const payload = Buffer.from(`${userId}\n${kind}`, "utf8").toString("base64url");
  return `${payload}.${mac(payload, secret).toString("base64url")}`;
}

/** The user + kind a token authorises, or null for anything malformed,
 *  tampered with, or signed with another key. */
export function verifyUnsubscribeToken(token: string, secret?: string): { userId: string; kind: EmailKind } | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;

  const expected = mac(parts[0], secret);
  const given = Buffer.from(parts[1], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const [userId, kind, ...rest] = Buffer.from(parts[0], "base64url").toString("utf8").split("\n");
  if (rest.length > 0 || !userId || !isEmailKind(kind)) return null;
  return { userId, kind };
}

/** Body link — a confirm page, never an automatic GET unsubscribe (mail
 *  scanners prefetch links). */
export function unsubscribePageUrl(token: string): string {
  return `${appOrigin()}/unsubscribe/${encodeURIComponent(token)}`;
}

/** RFC 8058 one-click target for the List-Unsubscribe header (POSTed by Gmail). */
export function oneClickUnsubscribeUrl(token: string): string {
  return `${appOrigin()}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function notificationSettingsUrl(): string {
  return `${appOrigin()}/settings/notifications`;
}
