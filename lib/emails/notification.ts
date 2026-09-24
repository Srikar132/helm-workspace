import { escapeHtml } from "@/lib/emails/html";
import { appOrigin, type BuiltEmail } from "@/lib/emails/invitation";
import { EMAIL_KIND_LABELS, type EmailKind } from "@/lib/email-unsubscribe";

export type NotificationEmailInput = {
  kind: EmailKind;
  actorName: string | null;
  workspaceName: string;
  /** e.g. "a comment", "a note", "Page · Project" — from the notification payload. */
  title: string;
  snippet?: string;
  /** Server-built, app-relative (`/workspace/...`). */
  href: string;
  unsubscribeUrl: string;
  settingsUrl: string;
};

export function notificationSubject(kind: EmailKind, actorName: string | null, title: string): string {
  const who = actorName ?? "Someone";
  return kind === "mention" ? `${who} mentioned you in ${title}` : `${who} replied to ${title}`;
}

/** Absolute link into the app — only ever an app-relative path from the
 *  notification payload, joined onto this deployment's own origin. */
export function openUrl(href: string): string {
  const path = href.startsWith("/") && !href.startsWith("//") ? href : "/";
  return `${appOrigin()}${path}`;
}

/**
 * Same visual language as the invitation email: inline styles, one column,
 * text + HTML. The snippet is the only user-written body text, and it is
 * escaped like every other interpolated value.
 */
export function buildNotificationEmail(input: NotificationEmailInput): BuiltEmail {
  const subject = notificationSubject(input.kind, input.actorName, input.title);
  const url = openUrl(input.href);
  const who = input.actorName ?? "Someone";
  const what = input.kind === "mention" ? "mentioned you" : "replied";
  const kindLabel = EMAIL_KIND_LABELS[input.kind];

  const text = [
    `${who} ${what} in ${input.title} (${input.workspaceName}).`,
    ...(input.snippet ? ["", `"${input.snippet}"`] : []),
    "",
    "Open in Helm:",
    url,
    "",
    "—",
    `Manage email notifications: ${input.settingsUrl}`,
    `Unsubscribe from ${kindLabel}: ${input.unsubscribeUrl}`,
  ].join("\n");

  const quote = input.snippet
    ? `<div style="margin:0 0 24px;padding:12px 16px;border-left:3px solid #1b6ef3;background:#f7f8fa;border-radius:0 8px 8px 0;font-size:15px;line-height:1.6;color:#111827;">${escapeHtml(input.snippet)}</div>`
    : "";

  const html = `
    <div style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">${escapeHtml(input.workspaceName)}</p>
        <h1 style="margin:0 0 16px;font-size:19px;line-height:1.35;color:#111827;">
          ${escapeHtml(who)} ${what} in ${escapeHtml(input.title)}
        </h1>
        ${quote}
        <a href="${escapeHtml(url)}"
           style="display:inline-block;background:#1b6ef3;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">
          Open in Helm
        </a>
        <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12.5px;line-height:1.6;color:#6b7280;">
          You're getting this because of your notification settings in Helm.
          <a href="${escapeHtml(input.settingsUrl)}" style="color:#6b7280;">Manage email notifications</a>
          or <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7280;">unsubscribe from ${kindLabel}</a>.
        </p>
      </div>
    </div>
  `.trim();

  return { subject, html, text };
}
