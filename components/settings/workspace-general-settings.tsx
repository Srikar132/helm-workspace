"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/settings-shell";
import { renameWorkspaceAction } from "@/lib/actions/organization";
import { workspaceMembersKey } from "@/lib/query-keys";
import { unwrapAction } from "@/lib/query-utils";
import { toastManager } from "@/lib/toast";

interface WorkspaceGeneralSettingsProps {
  slug: string;
  organizationName: string;
  canManage: boolean;
}

export function WorkspaceGeneralSettings({ slug, organizationName, canManage }: WorkspaceGeneralSettingsProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(organizationName);
  const [saved, setSaved] = useState(organizationName);

  const { mutate: rename, isPending } = useMutation({
    mutationFn: (next: string) => {
      const fd = new FormData();
      fd.set("name", next);
      return unwrapAction(renameWorkspaceAction({}, fd));
    },
    onSuccess: (_res, next) => {
      setSaved(next);
      // The cached members entry carries organizationName (the delete dialog
      // asks you to retype it), and the workspace switcher reads better-auth's
      // own client cache — refresh both.
      void queryClient.invalidateQueries({ queryKey: workspaceMembersKey(slug) });
      router.refresh();
      toastManager.add({ title: "Workspace renamed", type: "success" });
    },
    onError: (err) => toastManager.add({ title: "Name not saved", description: err.message, type: "error" }),
  });

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== saved;

  return (
    <SettingsCard>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !isPending) rename(trimmed);
        }}
        className="p-4 sm:p-5"
      >
        <label htmlFor="workspace-name" className="mb-1.5 block text-[13px] font-medium text-foreground">
          Workspace name
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <input
              id="workspace-name"
              type="text"
              value={name}
              maxLength={80}
              readOnly={!canManage}
              onChange={(e) => setName(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-background px-3.5 text-[13.5px] text-foreground outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/30 read-only:cursor-default read-only:bg-muted/50 read-only:text-muted-foreground dark:bg-input/30"
            />
            {!canManage && <Lock aria-hidden className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />}
          </div>
          {canManage && (
            <Button type="submit" variant="default" shape="rounded" disabled={!dirty || isPending} className="h-10 gap-1.5 px-4">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </Button>
          )}
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {canManage
            ? "Shown in the workspace switcher, invitations and notification emails."
            : "Only owners and admins can rename the workspace."}
        </p>
      </form>
    </SettingsCard>
  );
}
