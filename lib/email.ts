import { Resend } from "resend";

/**
 * Outbound app email — invitations and notification emails — through Resend,
 * sending from the verified `helmworkspace.me` domain.
 *
 * It used to be SMTP with a Gmail app password, only because the app had no
 * domain of its own and every API provider requires a DNS-verified sender.
 * Callers never saw that: they only ever call `sendEmail`, which is still the
 * whole surface.
 *
 * With no RESEND_API_KEY this is a no-op that logs what it would have sent —
 * same graceful-degradation choice as lib/rate-limit.ts, so local dev, tests
 * and CI never need secrets.
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Always send one — HTML-only mail scores worse with
   *  spam filters and breaks text-only clients. */
  text: string;
  /** Extra headers, e.g. List-Unsubscribe for notification mail. */
  headers?: Record<string, string>;
  /** Resend dedupes sends with the same key (24h), so a retry after an
   *  unknown outcome can't deliver twice. */
  idempotencyKey?: string;
};

export type SendEmailResult = { delivered: boolean; skippedReason?: string };

const DEFAULT_FROM = "Helm <notifications@helmworkspace.me>";

let cachedClient: Resend | null = null;

function getClient(apiKey: string): Resend {
  if (!cachedClient) cachedClient = new Resend(apiKey);
  return cachedClient;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Throws when Resend rejects the send, so callers with a retry path (the
 *  notification outbox) can record the failure. */
export async function sendEmail({ to, subject, html, text, headers, idempotencyKey }: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(`[email] RESEND_API_KEY not set — would have sent "${subject}" to ${to}`);
    return { delivered: false, skippedReason: "Email not configured" };
  }

  const { error } = await getClient(apiKey).emails.send(
    { from: process.env.EMAIL_FROM || DEFAULT_FROM, to, subject, html, text, headers },
    idempotencyKey ? { idempotencyKey } : undefined,
  );
  if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
  return { delivered: true };
}
