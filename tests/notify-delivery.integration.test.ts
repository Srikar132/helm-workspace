// Opt-in: runs the real notify() + deliverOutbox() against the database in
// .env.local, with only the network send mocked. `RUN_DB_TESTS=1 npx vitest run
// tests/notify-delivery.integration.test.ts`. Cleans up every row it creates.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, emailOutbox, member, notificationPreferences, notifications, user } from "@/lib/db";

const sendEmail = vi.fn(async () => ({ delivered: true }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail: (...args: unknown[]) => (sendEmail as (...a: unknown[]) => unknown)(...args) }));

import { notify, notifyNewMentions, commentMentionDedupeKey, threadHref } from "@/lib/notifications";
import { deliverOutbox } from "@/lib/notification-email";

const enabled = process.env.RUN_DB_TESTS === "1";
const sourceId = crypto.randomUUID();
const commentId = crypto.randomUUID();
let orgId = "";
let actor = { id: "", name: "" };
let recipient = { id: "", email: "" };
let bystander = { id: "" };
let strangerId = "";
let prefBefore: { emailEnabled: boolean } | undefined;

const payload = (slug: string) => ({ href: threadHref(slug, sourceId), title: "a comment", snippet: "ping" });
const mentionBody = (id: string, label: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id, label } }, { type: "text", text: " hi" }] }],
});

describe.skipIf(!enabled)("comment mention → in-app + email (real DB, mocked send)", () => {
  beforeAll(async () => {
    const rows = await db.select({ orgId: member.organizationId, userId: member.userId }).from(member);
    const byOrg = new Map<string, string[]>();
    for (const r of rows) byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r.userId]);
    const entry = [...byOrg.entries()].find(([, ids]) => ids.length >= 2);
    if (!entry) throw new Error("need a workspace with two members");
    orgId = entry[0];
    const [a, b] = entry[1];
    const [ua] = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, a));
    const [ub] = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, b));
    actor = ua;
    recipient = ub;
    const others = entry[1].filter((id) => id !== a && id !== b);
    bystander = { id: others[0] ?? "" };
    const memberIds = new Set(rows.filter((r) => r.orgId === orgId).map((r) => r.userId));
    const outsider = (await db.select({ id: user.id }).from(user)).find((u) => !memberIds.has(u.id));
    strangerId = outsider?.id ?? "";
    [prefBefore] = await db
      .select({ emailEnabled: notificationPreferences.emailEnabled })
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, recipient.id), eq(notificationPreferences.kind, "mention")));
    await db.delete(notificationPreferences).where(and(eq(notificationPreferences.userId, recipient.id), eq(notificationPreferences.kind, "mention")));
  });

  afterAll(async () => {
    await db.delete(notifications).where(eq(notifications.sourceId, sourceId));
    await db.delete(notificationPreferences).where(and(eq(notificationPreferences.userId, recipient.id), eq(notificationPreferences.kind, "mention")));
    if (prefBefore) {
      await db.insert(notificationPreferences).values({ userId: recipient.id, kind: "mention", emailEnabled: prefBefore.emailEnabled });
    }
  });

  const rowsFor = (key?: string) =>
    db.select().from(notifications).where(and(eq(notifications.sourceId, sourceId), key ? eq(notifications.dedupeKey, key) : undefined));

  it("notifies only the mentioned member, then emails them once", async () => {
    sendEmail.mockClear();
    await notify({
      organizationId: orgId,
      actorType: "user",
      actorId: actor.id,
      kind: "mention",
      sourceType: "comment_thread",
      sourceId,
      // actor mentions themself, the recipient, a stranger, and a duplicate
      recipientIds: [actor.id, recipient.id, recipient.id, ...(strangerId ? [strangerId] : [])],
      payload,
      dedupeKey: (id) => commentMentionDedupeKey(commentId, id),
    });

    const created = await rowsFor();
    expect(created.map((r) => r.recipientId)).toEqual([recipient.id]);
    expect(created[0]).toMatchObject({ kind: "mention", actorId: actor.id, readAt: null });
    if (bystander.id) expect(created.some((r) => r.recipientId === bystander.id)).toBe(false);

    // notify() already delivered in-line; the mocked sender saw exactly one mail.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string; text: string; headers: Record<string, string> }];
    expect(sent[0].to).toBe(recipient.email);
    expect(sent[0].text).toContain("ping");
    expect(sent[0].headers["List-Unsubscribe"]).toContain("http");
    const [outbox] = await db.select().from(emailOutbox).where(eq(emailOutbox.notificationId, created[0].id));
    expect(outbox).toMatchObject({ status: "sent", recipientId: recipient.id, attempts: 1 });
  });

  it("is idempotent — the same comment never notifies or emails twice", async () => {
    sendEmail.mockClear();
    await notify({
      organizationId: orgId,
      actorType: "user",
      actorId: actor.id,
      kind: "mention",
      sourceType: "comment_thread",
      sourceId,
      recipientIds: [recipient.id],
      payload,
      dedupeKey: (id) => commentMentionDedupeKey(commentId, id),
    });
    expect(await rowsFor()).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await deliverOutbox()).sent).toBe(0);
  });

  it("an edit that adds a mention notifies only the newly added person", async () => {
    sendEmail.mockClear();
    const editId = crypto.randomUUID();
    await notifyNewMentions({
      organizationId: orgId,
      actorId: actor.id,
      sourceType: "comment_thread",
      sourceId,
      prev: mentionBody(recipient.id, "x"),
      next: mentionBody(recipient.id, "x"),
      title: "a comment",
      href: (slug) => threadHref(slug, sourceId),
      dedupeKey: (id) => commentMentionDedupeKey(editId, id),
    });
    expect(await rowsFor(commentMentionDedupeKey(editId, recipient.id))).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("respects the recipient's mention-email preference (in-app yes, email no)", async () => {
    await db.insert(notificationPreferences).values({ userId: recipient.id, kind: "mention", emailEnabled: false });
    sendEmail.mockClear();
    const otherComment = crypto.randomUUID();
    await notify({
      organizationId: orgId,
      actorType: "user",
      actorId: actor.id,
      kind: "mention",
      sourceType: "comment_thread",
      sourceId,
      recipientIds: [recipient.id],
      payload,
      dedupeKey: (id) => commentMentionDedupeKey(otherComment, id),
    });
    const [row] = await rowsFor(commentMentionDedupeKey(otherComment, recipient.id));
    expect(row).toBeDefined();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await db.select().from(emailOutbox).where(inArray(emailOutbox.notificationId, [row.id]))).toHaveLength(0);
  });
});
