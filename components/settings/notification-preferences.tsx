"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, BellRing, MessageSquareReply } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-shell";
import {
  getNotificationPreferencesAction,
  setEmailPreferenceAction,
  type EmailPreferences,
} from "@/lib/actions/notification-preferences";
import type { EmailKind } from "@/lib/email-unsubscribe";
import { notificationPreferencesKey } from "@/lib/query-keys";
import { unwrapAction } from "@/lib/query-utils";
import { toastManager } from "@/lib/toast";
import { cn } from "@/lib/utils";

const ROWS: { kind: EmailKind; title: string; description: string; icon: typeof AtSign }[] = [
  {
    kind: "mention",
    title: "Mentions",
    description: "Email me when someone @mentions me in a note, a doc page or a comment.",
    icon: AtSign,
  },
  {
    kind: "comment_reply",
    title: "Replies",
    description: "Email me when someone replies in a comment thread I started or joined.",
    icon: MessageSquareReply,
  },
];

export function NotificationPreferences({ initialPreferences }: { initialPreferences: EmailPreferences }) {
  const queryClient = useQueryClient();
  const key = notificationPreferencesKey();

  const { data: prefs = initialPreferences } = useQuery({
    queryKey: key,
    queryFn: () => getNotificationPreferencesAction(),
    initialData: initialPreferences,
    // The page just rendered these on the server; no need to ask again on mount.
    staleTime: 60_000,
  });

  const { mutate: setPreference } = useMutation({
    mutationFn: (input: { kind: EmailKind; enabled: boolean }) => unwrapAction(setEmailPreferenceAction(input)),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EmailPreferences>(key);
      queryClient.setQueryData<EmailPreferences>(key, (old) => ({ ...(old ?? initialPreferences), [input.kind]: input.enabled }));
      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toastManager.add({ title: "Setting not saved", description: err.message, type: "error" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <SettingsCard>
      <div className="flex items-start gap-3 border-b border-border bg-muted/40 px-4 py-3 sm:px-5">
        <BellRing aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          The bell in Helm always shows everything. These switches only decide what also reaches{" "}
          <span className="font-medium text-foreground">your inbox</span>, in every workspace you&apos;re in.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {ROWS.map(({ kind, title, description, icon: Icon }) => {
          const enabled = prefs[kind];
          const id = `email-pref-${kind}`;
          return (
            <li key={kind}>
              <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-4 py-3.5 sm:px-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-foreground">{title}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{description}</span>
                </span>
                <button
                  id={id}
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => setPreference({ kind, enabled: !enabled })}
                  className={cn(
                    "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    enabled ? "bg-primary" : "bg-input dark:bg-muted",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
                      enabled ? "translate-x-[18px]" : "translate-x-0.5",
                    )}
                  />
                </button>
              </label>
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}
