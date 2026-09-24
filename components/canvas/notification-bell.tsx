"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  getUnreadNotificationCountAction,
  listNotificationsAction,
  markNotificationsReadAction,
  type NotificationItem,
} from "@/lib/actions/notifications";
import { notificationKeys } from "@/lib/query-keys";
import { unwrapAction } from "@/lib/query-utils";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/relative-time";

/**
 * Polls rather than pushes: the count refreshes every minute and on focus,
 * the list is fetched only while open. Per-user keys, excluded from the
 * localStorage persister (see lib/query-keys.ts).
 */

const POLL_MS = 60_000;

function describe(item: NotificationItem): string {
  const who = item.actorName ?? "Someone";
  switch (item.kind) {
    case "mention":
      return `${who} mentioned you in ${item.payload.title}`;
    case "comment_reply":
      return `${who} replied to ${item.payload.title}`;
    default:
      return item.payload.title;
  }
}

export function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: unread = 0 } = useQuery({
    queryKey: notificationKeys.count(),
    queryFn: () => getUnreadNotificationCountAction(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isPending } = useInfiniteQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) => listNotificationsAction(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    maxPages: 5,
    enabled: open,
    // Opening the bell should always show what's there now.
    staleTime: 0,
  });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const { mutate: markRead } = useMutation({
    mutationFn: (ids: string[] | "all") => unwrapAction(markNotificationsReadAction(ids)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });

  function openItem(item: NotificationItem) {
    if (!item.read) markRead([item.id]);
    const target = new URL(item.payload.href, window.location.origin);
    // Same page (a note on the canvas you're looking at): push the URL without
    // a navigation, so the canvas's ?focus listener flies there instead of the
    // force-dynamic route refetching the whole workspace.
    if (target.pathname === pathname) {
      window.history.pushState(null, "", `${target.pathname}${target.search}`);
    } else {
      router.push(item.payload.href);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="pointer-events-auto relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border bg-card/85 shadow-lg backdrop-blur-md transition-colors hover:bg-card"
      >
        <Bell className="h-4 w-4 text-foreground" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-80 rounded-2xl border border-border p-1.5 shadow-2xl ring-0"
      >
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-[13px] font-medium">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markRead("all")}
              className="cursor-pointer text-[12px] text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>

        {isPending ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onClick={() => openItem(item)}
              className="items-start gap-2.5 rounded-xl px-2 py-2"
            >
              {item.actorImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote OAuth avatar; no-referrer because Google avatars 429 hotlinked requests
                <img src={item.actorImage} alt="" referrerPolicy="no-referrer" className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                  {(item.actorName ?? "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[13px] leading-snug", item.read && "text-muted-foreground")}>
                  {describe(item)}
                </span>
                {item.payload.snippet && (
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{item.payload.snippet}</span>
                )}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {item.workspaceName} · {timeAgo(item.createdAt)}
                </span>
              </span>
              {!item.read && <span aria-label="Unread" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
            </DropdownMenuItem>
          ))
        )}

        {hasNextPage && (
          <DropdownMenuItem
            closeOnClick={false}
            disabled={isFetchingNextPage}
            onClick={() => {
              if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
            }}
            className="justify-center rounded-xl py-1.5 text-[12px] text-primary"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
