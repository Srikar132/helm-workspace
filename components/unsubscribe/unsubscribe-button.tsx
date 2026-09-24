"use client";

import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { unsubscribeWithTokenAction } from "@/lib/actions/notification-preferences";
import { unwrapAction } from "@/lib/query-utils";

export function UnsubscribeButton({ token, label }: { token: string; label: string }) {
  const { mutate, isPending, isSuccess, error } = useMutation({
    mutationFn: () => unwrapAction(unsubscribeWithTokenAction(token)),
  });

  if (isSuccess) {
    return <p className="mt-5 text-sm font-medium text-foreground">Done — {label} are off.</p>;
  }

  return (
    <div className="mt-5">
      <Button type="button" onClick={() => mutate()} disabled={isPending} className="w-full">
        {isPending ? "Turning off…" : `Turn off ${label}`}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error.message}</p>}
    </div>
  );
}
