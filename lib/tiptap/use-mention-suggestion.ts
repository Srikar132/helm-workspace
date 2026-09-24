"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listMentionableMembersAction, type MentionableMember } from "@/lib/actions/members";
import { mentionableMembersKey } from "@/lib/query-keys";
import { createMentionSuggestion } from "@/lib/tiptap/mention-suggestion";

/**
 * The `@` picker config for an editor, or undefined where no one can mention:
 * no workspace slug (the public share page has none, and no session to ask
 * with) → no picker at all. The member list is fetched only while `canWrite`,
 * so a view-only member never asks for it.
 *
 * Returned once and never replaced — useEditor builds its extensions a single
 * time — so the suggestion reads members from the query cache at keystroke
 * time rather than capturing a value that would go stale.
 */
export function useMentionSuggestion(slug: string | undefined, canWrite: boolean) {
  const queryClient = useQueryClient();
  const queryKey = mentionableMembersKey(slug ?? "");

  useQuery({
    queryKey,
    queryFn: () => listMentionableMembersAction(),
    enabled: Boolean(slug) && canWrite,
    staleTime: 5 * 60 * 1000,
  });

  const [suggestion] = useState(() =>
    slug
      ? createMentionSuggestion(() => queryClient.getQueryData<MentionableMember[]>(queryKey) ?? [])
      : undefined,
  );
  return suggestion;
}
