"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2, Send, UserMinus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyInviteLinkButton } from "@/components/invitations/copy-invite-link-button";
import { InviteEmailField } from "@/components/settings/invite-email-field";
import { SettingsCard } from "@/components/settings/settings-shell";
import { CommentAvatar } from "@/components/canvas/comments/comment-avatar";
import {
  cancelInvitationAction,
  getWorkspaceMembersData,
  inviteMemberAction,
  listPendingInvitationsAction,
  removeMemberAction,
} from "@/lib/actions/members";
import { accessLevelLabel } from "@/lib/emails/invitation";
import { unwrapAction } from "@/lib/query-utils";
import { workspaceMembersKey } from "@/lib/query-keys";
import { toastManager } from "@/lib/toast";
import { cn } from "@/lib/utils";

type WorkspaceMembersData = Awaited<ReturnType<typeof getWorkspaceMembersData>>;
type Member = WorkspaceMembersData["members"][number];
type Invitation = WorkspaceMembersData["invitations"][number];

// Deliberately loose: real address validity is the server's call (and the
// mail server's), this only decides whether the Invite button is worth enabling.
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const ROLE_STYLES: Record<string, string> = {
  owner: "border-primary/25 bg-primary/10 text-primary",
  admin: "border-border bg-muted text-foreground",
  member: "border-border text-muted-foreground",
};

function toastError(title: string) {
  return (err: Error) => toastManager.add({ title, description: err.message, type: "error" });
}

interface WorkspaceMembersManagerProps {
  /** Identifies which workspace's cache to invalidate — see workspaceMembersKey. */
  slug: string;
  initialMembers: Member[];
  initialInvitations: Invitation[];
  canManage: boolean;
  viewerUserId: string;
}

export function WorkspaceMembersManager({
  slug,
  initialMembers,
  initialInvitations,
  canManage,
  viewerUserId,
}: WorkspaceMembersManagerProps) {
  const queryClient = useQueryClient();
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [email, setEmail] = useState("");

  // Keyed by workspace (lib/query-keys.ts) so one workspace's cached members
  // can never be served for another.
  const invalidateMembers = () => void queryClient.invalidateQueries({ queryKey: workspaceMembersKey(slug) });

  // Each control watches its OWN mutation — one shared pending flag put every
  // button on the page into a spinner while a single invite was sending.
  const { mutate: invite, isPending: inviting } = useMutation({
    mutationFn: (address: string) => {
      const fd = new FormData();
      fd.set("email", address);
      fd.set("accessLevel", "view");
      return unwrapAction(inviteMemberAction({}, fd));
    },
    onSuccess: async (_res, address) => {
      setEmail("");
      const { invitations: fresh } = await listPendingInvitationsAction();
      setInvitations(fresh);
      invalidateMembers();
      toastManager.add({ title: "Invitation sent", description: address, type: "success" });
    },
    onError: toastError("Invitation not sent"),
  });

  const { mutate: removeMember, isPending: removing, variables: removingId } = useMutation({
    mutationFn: (memberId: string) => {
      const fd = new FormData();
      fd.set("memberIdOrEmail", memberId);
      return unwrapAction(removeMemberAction({}, fd));
    },
    onSuccess: (_res, memberId) => {
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      invalidateMembers();
    },
    onError: toastError("Member not removed"),
  });

  const { mutate: cancelInvite, isPending: cancelling, variables: cancellingId } = useMutation({
    mutationFn: (invitationId: string) => {
      const fd = new FormData();
      fd.set("invitationId", invitationId);
      return unwrapAction(cancelInvitationAction({}, fd));
    },
    onSuccess: (_res, invitationId) => {
      setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
      invalidateMembers();
    },
    onError: toastError("Invitation not cancelled"),
  });

  const canInvite = isValidEmail(email) && !inviting;
  const submitInvite = () => canInvite && invite(email.trim());

  return (
    <SettingsCard>
      {canManage && (
        <div className="border-b border-border p-4 sm:p-5">
          <label htmlFor="invite-email" className="mb-1.5 block text-[13px] font-medium text-foreground">
            Invite by email
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitInvite();
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <InviteEmailField id="invite-email" slug={slug} value={email} onChange={setEmail} onSubmit={submitInvite} disabled={inviting} />
            <Button type="submit" variant="default" shape="rounded" disabled={!canInvite} className="h-10 gap-1.5 px-4">
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send invite
            </Button>
          </form>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {email.trim().length > 0 && !isValidEmail(email)
              ? "Enter a full email address."
              : "Invited people can view everything in this workspace and join comment threads. Edit access is coming later."}
          </p>
        </div>
      )}

      {canManage && invitations.length > 0 && (
        <div className="border-b border-border">
          <h3 className="px-4 pb-1 pt-3.5 text-[12.5px] font-medium text-muted-foreground sm:px-5">
            Waiting to accept ({invitations.length})
          </h3>
          <ul>
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                  <Clock className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] text-foreground">{inv.email}</div>
                  <div className="text-[12px] text-muted-foreground">Invited as {accessLevelLabel(inv.role)}</div>
                </div>
                <CopyInviteLinkButton invitationId={inv.id} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  shape="pill"
                  onClick={() => cancelInvite(inv.id)}
                  disabled={cancelling && cancellingId === inv.id}
                  title="Cancel invitation"
                  aria-label={`Cancel invitation for ${inv.email}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {cancelling && cancellingId === inv.id ? <Loader2 className="animate-spin" /> : <X />}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="divide-y divide-border">
        {members.map((m) => {
          const isSelf = m.userId === viewerUserId;
          const canRemove = canManage && !isSelf && m.role !== "owner";
          const pending = removing && removingId === m.id;
          return (
            <li key={m.id} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", pending && "opacity-60")}>
              <CommentAvatar name={m.user.name} image={m.user.image ?? null} className="h-9 w-9 text-[13px]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-medium text-foreground">{m.user.name}</span>
                  {isSelf && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
                      You
                    </span>
                  )}
                </div>
                <div className="truncate text-[12.5px] text-muted-foreground">{m.user.email}</div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[11.5px] font-medium sm:px-2.5 sm:text-[12px]",
                  ROLE_STYLES[m.role] ?? ROLE_STYLES.member,
                )}
              >
                {accessLevelLabel(m.role)}
              </span>
              {canRemove ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  shape="pill"
                  onClick={() => {
                    if (window.confirm(`Remove ${m.user.name} from this workspace?`)) removeMember(m.id);
                  }}
                  disabled={pending}
                  title="Remove from workspace"
                  aria-label={`Remove ${m.user.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {pending ? <Loader2 className="animate-spin" /> : <UserMinus />}
                </Button>
              ) : (
                canManage && <span aria-hidden className="w-8 shrink-0" />
              )}
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}
