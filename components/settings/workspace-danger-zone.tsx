"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteWorkspaceAction } from "@/lib/actions/organization";
import { unwrapAction } from "@/lib/query-utils";
import { toastManager } from "@/lib/toast";

interface WorkspaceDangerZoneProps {
  /** The name the user must retype. Comes from the server-rendered page, so it
   *  is the real current name — an earlier version compared against a cached
   *  copy and rejected the very name it was displaying. */
  organizationName: string;
}

/** Deleting a workspace, gated behind retyping its name — the one
 *  irreversible action on the page, so it sits apart from everything else. */
export function WorkspaceDangerZone({ organizationName }: WorkspaceDangerZoneProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const { mutate: deleteWorkspace, isPending } = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      // Trimmed to match the check below, so a stray pasted space can't enable
      // the button and then be rejected by the server.
      fd.set("confirmName", confirmText.trim());
      return unwrapAction(deleteWorkspaceAction({}, fd));
    },
    // Full navigation, not router.push — the org this page is scoped to no
    // longer exists, so nothing here should try to re-render.
    onSuccess: () => {
      window.location.href = "/workspaces";
    },
    onError: (err) => toastManager.add({ title: "Workspace not deleted", description: err.message, type: "error" }),
  });

  const matches = confirmText.trim() === organizationName.trim();

  return (
    <div className="overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/3">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-foreground">Delete this workspace</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Removes the canvas, board, docs, albums, comments and every member&apos;s access. This can&apos;t be undone.
          </p>
        </div>
        {!confirmOpen && (
          <Button
            type="button"
            variant="destructive"
            shape="rounded"
            onClick={() => setConfirmOpen(true)}
            className="h-10 shrink-0 gap-1.5 px-4"
          >
            <Trash2 className="h-4 w-4" />
            Delete workspace
          </Button>
        )}
      </div>

      {confirmOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !isPending) deleteWorkspace();
          }}
          className="border-t border-destructive/20 p-4 sm:p-5"
        >
          <label htmlFor="confirm-delete" className="mb-1.5 block text-[13px] text-muted-foreground">
            Type <span className="font-semibold text-foreground">{organizationName}</span> to confirm
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="confirm-delete"
              type="text"
              autoFocus
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-xl border border-destructive/30 bg-background px-3.5 text-[13.5px] text-foreground outline-none transition-colors focus:border-destructive/60 focus:ring-3 focus:ring-destructive/20 dark:bg-input/30"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                shape="rounded"
                disabled={!matches || isPending}
                className="h-10 flex-1 gap-1.5 px-4 sm:flex-none"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete forever
              </Button>
              <Button
                type="button"
                variant="ghost"
                shape="rounded"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmText("");
                }}
                className="h-10 px-4 text-muted-foreground"
              >
                Cancel
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
