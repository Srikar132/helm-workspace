"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useReactFlow } from "@xyflow/react";
import {
  createCommentThreadAction,
  deleteCommentThreadAction,
  listCommentThreadsAction,
  moveCommentThreadAction,
  setThreadResolvedAction,
  type ThreadSummary,
} from "@/lib/actions/comments";
import { useSession } from "@/lib/auth-client";
import { commentThreadKey, commentThreadsKey } from "@/lib/query-keys";
import { unwrapAction } from "@/lib/query-utils";
import type { CanvasMode } from "@/lib/canvas/widget-interaction";
import { toastManager } from "@/lib/toast";

/** Server-derived inputs for the comment layer — who may do what. */
export type CanvasCommentsConfig = {
  initialThreads: ThreadSummary[];
  canComment: boolean;
  canModerate: boolean;
  viewerUserId: string;
};

export type DraftPin = { x: number; y: number };

const POLL_MS = 60_000;

function useCanvasCommentsState({ slug, config, mode }: { slug: string; config: CanvasCommentsConfig; mode: CanvasMode }) {
  const queryClient = useQueryClient();
  const { screenToFlowPosition } = useReactFlow();
  const { data: session } = useSession();
  const { data: threads = [] } = useQuery({
    queryKey: commentThreadsKey(slug),
    queryFn: () => listCommentThreadsAction(),
    initialData: config.initialThreads,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  /** The pin that just landed — it plays its drop-in once. */
  const [justPlacedId, setJustPlacedId] = useState<string | null>(null);

  const openThread = useCallback((id: string | null) => {
    setDraft(null);
    setOpenThreadId(id);
  }, []);

  const startDraftAtViewportCenter = useCallback(() => {
    const at = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setOpenThreadId(null);
    setDraft({ x: Math.round(at.x), y: Math.round(at.y) });
  }, [screenToFlowPosition]);

  const cancelDraft = useCallback(() => setDraft(null), []);

  const patchThread = useCallback(
    (id: string, patch: Partial<ThreadSummary>) =>
      queryClient.setQueryData<ThreadSummary[]>(commentThreadsKey(slug), (old) =>
        old?.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      ),
    [queryClient, slug],
  );

  const invalidateList = useCallback(
    () => queryClient.invalidateQueries({ queryKey: commentThreadsKey(slug) }),
    [queryClient, slug],
  );

  const { mutate: createThread, isPending: creating } = useMutation({
    mutationFn: (input: { x: number; y: number; body: Record<string, unknown> }) =>
      unwrapAction(createCommentThreadAction(input)),
    onSuccess: ({ thread }) => {
      if (!thread) return;
      const withAvatar = { ...thread, authorImage: session?.user.image ?? null };
      queryClient.setQueryData<ThreadSummary[]>(commentThreadsKey(slug), (old) => [...(old ?? []), withAvatar]);
      setDraft(null);
      setJustPlacedId(thread.id);
      setOpenThreadId(thread.id);
    },
    onError: (err) => toastManager.add({ title: "Comment not posted", description: err.message, type: "error" }),
    onSettled: invalidateList,
  });

  const { mutate: moveThread } = useMutation({
    mutationFn: (input: { threadId: string; x: number; y: number }) => unwrapAction(moveCommentThreadAction(input)),
    onMutate: (input) => {
      const previous = queryClient.getQueryData<ThreadSummary[]>(commentThreadsKey(slug));
      patchThread(input.threadId, { x: input.x, y: input.y });
      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(commentThreadsKey(slug), context.previous);
      toastManager.add({ title: "Comment not moved", description: err.message, type: "error" });
    },
    onSettled: invalidateList,
  });

  const { mutate: setResolved } = useMutation({
    mutationFn: (input: { threadId: string; resolved: boolean }) =>
      unwrapAction(setThreadResolvedAction(input.threadId, input.resolved)),
    onMutate: (input) => {
      const previous = queryClient.getQueryData<ThreadSummary[]>(commentThreadsKey(slug));
      patchThread(input.threadId, { resolved: input.resolved });
      // Resolving closes the thread; the pin fades away unless resolved ones are shown.
      if (input.resolved) setOpenThreadId(null);
      return { previous };
    },
    onSuccess: (_data, input) => {
      if (!input.resolved) return;
      // The pin vanishes on resolve — give an immediate way back.
      toastManager.add({
        title: "Thread resolved",
        description: "It's hidden from the canvas. Show resolved comments from the dock.",
        actionProps: {
          children: "Undo",
          onClick: () => {
            setResolved({ threadId: input.threadId, resolved: false });
            setOpenThreadId(input.threadId);
          },
        },
      });
    },
    onError: (err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(commentThreadsKey(slug), context.previous);
      toastManager.add({ title: "Couldn't update the thread", description: err.message, type: "error" });
    },
    onSettled: (_data, _err, input) => {
      void invalidateList();
      void queryClient.invalidateQueries({ queryKey: commentThreadKey(input.threadId) });
    },
  });

  const { mutate: deleteThread } = useMutation({
    mutationFn: (threadId: string) => unwrapAction(deleteCommentThreadAction(threadId)),
    onMutate: (threadId) => {
      const previous = queryClient.getQueryData<ThreadSummary[]>(commentThreadsKey(slug));
      queryClient.setQueryData<ThreadSummary[]>(commentThreadsKey(slug), (old) => old?.filter((t) => t.id !== threadId));
      setOpenThreadId(null);
      return { previous };
    },
    onError: (err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(commentThreadsKey(slug), context.previous);
      toastManager.add({ title: "Thread not deleted", description: err.message, type: "error" });
    },
    onSettled: (_data, _err, threadId) => {
      void invalidateList();
      queryClient.removeQueries({ queryKey: commentThreadKey(threadId) });
    },
  });

  // Drawing tools own every pointer event on the canvas; pins would steal them.
  const pinsHidden = mode === "draw" || mode === "laser";
  const visibleThreads = useMemo(
    () => threads.filter((t) => showResolved || !t.resolved || t.id === openThreadId),
    [threads, showResolved, openThreadId],
  );
  const resolvedCount = useMemo(() => threads.filter((t) => t.resolved).length, [threads]);

  return {
    slug,
    config,
    threads,
    visibleThreads,
    resolvedCount,
    pinsHidden,
    openThreadId,
    openThread,
    draft,
    startDraftAtViewportCenter,
    cancelDraft,
    creating,
    createThread,
    moveThread,
    setResolved,
    deleteThread,
    showResolved,
    setShowResolved,
    justPlacedId,
    invalidateList,
    patchThread,
  };
}

export type CanvasCommentsApi = ReturnType<typeof useCanvasCommentsState>;

const CanvasCommentsContext = createContext<CanvasCommentsApi | null>(null);

export { useCanvasCommentsState, CanvasCommentsContext };

export function useCanvasComments(): CanvasCommentsApi {
  const api = useContext(CanvasCommentsContext);
  if (!api) throw new Error("useCanvasComments must be used inside the canvas comments provider");
  return api;
}
