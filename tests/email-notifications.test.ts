import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  EMAIL_KINDS,
  createUnsubscribeToken,
  isEmailKind,
  oneClickUnsubscribeUrl,
  unsubscribePageUrl,
  verifyUnsubscribeToken,
} from "@/lib/email-unsubscribe";
import { buildNotificationEmail, notificationSubject, openUrl } from "@/lib/emails/notification";
import { MAX_EMAILS_PER_HOUR, emailSkipReason } from "@/lib/notification-email";
import { escapeHtml } from "@/lib/emails/html";

const SECRET = "test-secret-for-unsubscribe-tokens";

beforeAll(() => {
  process.env.BETTER_AUTH_URL = "https://helmworkspace.me";
});

describe("unsubscribe tokens", () => {
  it("round-trips user and kind", () => {
    const token = createUnsubscribeToken("user_123", "mention", SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ userId: "user_123", kind: "mention" });
  });

  it("rejects a tampered payload, a tampered signature, and another key", () => {
    const token = createUnsubscribeToken("user_123", "mention", SECRET);
    const [payload, sig] = token.split(".");
    const otherPayload = Buffer.from("attacker\nmention").toString("base64url");
    expect(verifyUnsubscribeToken(`${otherPayload}.${sig}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${payload}.${sig.slice(0, -2)}AA`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(token, "a-different-secret")).toBeNull();
  });

  it("rejects junk without throwing", () => {
    for (const junk of ["", ".", "a.b.c", "not base64!.x", "x".repeat(600)]) {
      expect(verifyUnsubscribeToken(junk, SECRET)).toBeNull();
    }
  });

  it("only signs known kinds", () => {
    const payload = Buffer.from("user_1\nsomething_else").toString("base64url");
    // Even a correctly signed token for an unknown kind is refused.
    const key = createHmac("sha256", SECRET).update("email-unsubscribe:v1").digest();
    const sig = createHmac("sha256", key).update(payload).digest("base64url");
    expect(verifyUnsubscribeToken(`${payload}.${sig}`, SECRET)).toBeNull();
    expect(EMAIL_KINDS.every(isEmailKind)).toBe(true);
  });

  it("builds absolute links on the app origin", () => {
    expect(unsubscribePageUrl("abc.def")).toBe("https://helmworkspace.me/unsubscribe/abc.def");
    expect(oneClickUnsubscribeUrl("abc.def")).toBe("https://helmworkspace.me/api/unsubscribe?token=abc.def");
  });
});

describe("emailSkipReason", () => {
  const base = { readAt: null, emailEnabled: true, stillMember: true, sentInLastHour: 0 };

  it("sends by default", () => {
    expect(emailSkipReason(base)).toBeNull();
  });

  it("skips disabled kinds, ex-members, already-read and over-cap", () => {
    expect(emailSkipReason({ ...base, emailEnabled: false })).toBe("disabled");
    expect(emailSkipReason({ ...base, stillMember: false })).toBe("not_member");
    expect(emailSkipReason({ ...base, readAt: new Date() })).toBe("already_read");
    expect(emailSkipReason({ ...base, sentInLastHour: MAX_EMAILS_PER_HOUR })).toBe("hourly_cap");
    expect(emailSkipReason({ ...base, sentInLastHour: MAX_EMAILS_PER_HOUR - 1 })).toBeNull();
  });
});

describe("notification email template", () => {
  const input = {
    kind: "mention" as const,
    actorName: "Asha <script>",
    workspaceName: "Team & Co",
    title: "a comment",
    snippet: 'is this fixed? <img src=x onerror="alert(1)">',
    href: "/workspace/team?thread=t1",
    unsubscribeUrl: "https://helmworkspace.me/unsubscribe/tok",
    settingsUrl: "https://helmworkspace.me/settings/notifications",
  };

  it("uses plain subjects per kind", () => {
    expect(notificationSubject("mention", "Asha", "a comment")).toBe("Asha mentioned you in a comment");
    expect(notificationSubject("comment_reply", null, "a comment")).toBe("Someone replied to a comment");
  });

  it("escapes every user-written value in the HTML", () => {
    const { html } = buildNotificationEmail(input);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain(escapeHtml("Team & Co"));
    expect(html).toContain("&lt;script&gt;");
  });

  it("links to the app and includes both unsubscribe routes", () => {
    const { html, text } = buildNotificationEmail(input);
    expect(html).toContain("https://helmworkspace.me/workspace/team?thread=t1");
    expect(text).toContain("https://helmworkspace.me/workspace/team?thread=t1");
    expect(text).toContain(input.unsubscribeUrl);
    expect(html).toContain(input.settingsUrl);
  });

  it("never turns a payload href into an off-site link", () => {
    expect(openUrl("//evil.example/x")).toBe("https://helmworkspace.me/");
    expect(openUrl("https://evil.example")).toBe("https://helmworkspace.me/");
    expect(openUrl("/workspace/a")).toBe("https://helmworkspace.me/workspace/a");
  });
});
