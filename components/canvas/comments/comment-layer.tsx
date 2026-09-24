"use client";

import { ViewportPortal, useViewport } from "@xyflow/react";
import { useSession } from "@/lib/auth-client";
import { CommentPin } from "@/components/canvas/comments/comment-pin";
import { CommentThreadPanel } from "@/components/canvas/comments/comment-thread-panel";
import { useCanvasComments } from "@/components/canvas/comments/canvas-comments-context";

/**
 * Comment pins, in canvas space but OUTSIDE xyflow's node list — the draw
 * overlay's precedent. As nodes they would flow through the widget-save path,
 * marquee select and Delete-key removal, none of which apply to a comment.
 */
export function CommentLayer() {
  const {
    visibleThreads,
    pinsHidden,
    openThreadId,
    openThread,
    draft,
    moveThread,
    justPlacedId,
    config,
  } = useCanvasComments();
  const { zoom } = useViewport();
  const { data: session } = useSession();

  return (
    <>
      {!pinsHidden && (
        <ViewportPortal>
          {visibleThreads.map((thread) => (
            <CommentPin
              key={thread.id}
              x={thread.x}
              y={thread.y}
              zoom={zoom}
              authorName={thread.authorName}
              authorImage={thread.authorImage}
              preview={thread.preview}
              replyCount={thread.replyCount}
              resolved={thread.resolved}
              active={thread.id === openThreadId}
              justPlaced={thread.id === justPlacedId}
              canMove={thread.authorId === config.viewerUserId || config.canModerate}
              onOpen={() => openThread(thread.id === openThreadId ? null : thread.id)}
              onMove={(x, y) => moveThread({ threadId: thread.id, x, y })}
            />
          ))}
          {draft && (
            <CommentPin
              x={draft.x}
              y={draft.y}
              zoom={zoom}
              authorName={session?.user.name ?? null}
              authorImage={session?.user.image ?? null}
              active
              justPlaced
              onOpen={() => {}}
            />
          )}
        </ViewportPortal>
      )}
      {!pinsHidden && <CommentThreadPanel />}
    </>
  );
}
