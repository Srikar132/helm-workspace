"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listMentionableMembersAction } from "@/lib/actions/members";
import { mentionableMembersKey } from "@/lib/query-keys";

/**
 * Current member names by user id, for rendering stored mentions. Shares the
 * `@` picker's query (same key, same fetch), so the list is usually already
 * cached; a mention shows its stored label until it resolves.
 */
export function useMentionNames(slug: string | undefined): ReadonlyMap<string, string> {
  const { data } = useQuery({
    queryKey: mentionableMembersKey(slug ?? ""),
    queryFn: () => listMentionableMembersAction(),
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => new Map((data ?? []).map((m) => [m.id, m.name])), [data]);
}
