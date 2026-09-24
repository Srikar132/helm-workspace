import { escapeHtml } from "@/lib/emails/html";

/** Where the app lives, for links inside emails. A relative URL is useless in
 *  an inbox, so this has to be absolute — BETTER_AUTH_URL is already the
 *  canonical "this deployment's origin" value auth uses for its own callbacks. */
export function appOrigin(): string {
  return (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function invitationUrl(invitationId: string): string {
  return `${appOrigin()}/accept-invitation/${encodeURIComponent(invitationId)}`;
}

// Better-auth's org roles, in the wording the UI already uses — an invitee
// shouldn't be shown an internal role name. `member` reads as "View only"
// because that's the only access level invites currently support (see
// mapAccessLevelToOrgRole in lib/permissions.ts).
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "View only",
};

export function accessLevelLabel(role: string | null | undefined): string {
  return (role && ROLE_LABELS[role]) || "View only";
}

export type InvitationEmailInput = {
  workspaceName: string;
  /** Display name of whoever sent it; falls back to their email. */
  inviterLabel: string;
  role: string | null | undefined;
  invitationId: string;
};

export type BuiltEmail = { subject: string; html: string; text: string };

/**
 * Inline styles only, table-free, single column — every inbox strips
 * <style> blocks and most ignore modern layout, so anything cleverer than this
 * renders differently in each client for no benefit.
 */
export function buildInvitationEmail({
  workspaceName,
  inviterLabel,
  role,
  invitationId,
}: InvitationEmailInput): BuiltEmail {
  const url = invitationUrl(invitationId);
  const access = accessLevelLabel(role);
  const subject = `${inviterLabel} invited you to ${workspaceName} on Helm`;

  const text = [
    `${inviterLabel} invited you to join the "${workspaceName}" workspace on Helm as ${access}.`,
    "",
    "Accept the invitation:",
    url,
    "",
    "If you weren't expecting this, you can ignore this email — nothing happens until you accept.",
  ].join("\n");

  const html = `
    <div style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#111827;">
          You've been invited to ${escapeHtml(workspaceName)}
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
          ${escapeHtml(inviterLabel)} invited you to join the
          <strong>${escapeHtml(workspaceName)}</strong> workspace on Helm as
          <strong>${escapeHtml(access)}</strong>.
        </p>
        <a href="${url}"
           style="display:inline-block;background:#1b6ef3;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">
          Accept invitation
        </a>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
          Or paste this link into your browser:<br />
          <a href="${url}" style="color:#1b6ef3;word-break:break-all;">${url}</a>
        </p>
        <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.6;color:#6b7280;">
          If you weren't expecting this, you can ignore this email — nothing happens until you accept.
        </p>
      </div>
    </div>
  `.trim();

  return { subject, html, text };
}
