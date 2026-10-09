"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { useCanvasActions } from "@/components/canvas/canvas-actions-context";
import { Skeleton } from "@/components/ui/skeleton";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  createDocProjectAction,
  deleteDocProjectAction,
  getDocProject,
  updateDocProjectAction,
  type DocProjectSummary,
} from "@/lib/actions/docs";
import { unwrapAction } from "@/lib/query-utils";
import { ProjectSpecForm, specDraftFrom } from "@/components/canvas/project-spec-form";
import { settledSize } from "@/lib/canvas/widget-sizing";
import { ProjectDocCardBody } from "@/components/canvas/project-doc-card-body";

interface ProjectDocWidgetProps {
  id: string;
  docProjectId?: string;
  slug?: string;
  canWrite: boolean;
  initialSummary?: DocProjectSummary;
}

export function ProjectDocWidget({ id, docProjectId, slug, canWrite, initialSummary }: ProjectDocWidgetProps) {
  if (!docProjectId) {
    return <DraftProjectForm id={id} canWrite={canWrite} />;
  }
  return <ProjectDocCard id={id} docProjectId={docProjectId} slug={slug} canWrite={canWrite} initialSummary={initialSummary} />;
}

function DraftProjectForm({ id, canWrite }: { id: string; canWrite: boolean }) {
  const { updateWidgetData, deleteWidget, resizeWidget } = useCanvasActions();
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (formData: FormData) => unwrapAction(createDocProjectAction({}, formData)),
    onSuccess: (res) => {
      updateWidgetData(id, { docProjectId: res.id });
      // The form needed room; the saved card is a compact summary. Set once,
      // after which the size is the user's.
      resizeWidget(id, settledSize("project-doc"));
    },
    onError: (err) => setError(err.message),
  });

  return (
    <ProjectSpecForm
      heading="New Project Doc"
      subheading="Register tech spec & repositories"
      initial={specDraftFrom()}
      submitLabel="Save Spec"
      pendingLabel="Creating…"
      isPending={createMutation.isPending}
      error={error}
      onSubmit={(formData) => {
        setError(null);
        createMutation.mutate(formData);
      }}
      // Nothing exists on the server yet, so backing out means removing the card.
      onCancel={() => {
        if (canWrite) deleteWidget(id);
      }}
      cancelLabel="Cancel"
    />
  );
}

function ProjectDocCard({
  id,
  docProjectId,
  slug,
  canWrite,
  initialSummary,
}: {
  id: string;
  docProjectId: string;
  slug?: string;
  canWrite: boolean;
  initialSummary?: DocProjectSummary;
}) {
  const { deleteWidget } = useCanvasActions();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const {
    data: project,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["docProject", docProjectId],
    queryFn: () => getDocProject(docProjectId),
    initialData: initialSummary,
  });

  const deleteMutation = useMutation({
    mutationFn: () => unwrapAction(deleteDocProjectAction(docProjectId)),
    onSuccess: () => deleteWidget(id),
    onError: (err) => console.error("Failed to delete doc project:", err),
  });

  const updateMutation = useMutation({
    mutationFn: (formData: FormData) => {
      formData.append("id", docProjectId);
      return unwrapAction(updateDocProjectAction({}, formData));
    },
    onSuccess: () => {
      // The canvas card and the docs page read the same key, so neither keeps
      // showing the pre-edit spec.
      void queryClient.invalidateQueries({ queryKey: ["docProject", docProjectId] });
      setIsEditing(false);
    },
    onError: (err) => setEditError(err.message),
  });

  function handleDeleteProject() {
    if (!window.confirm("Delete this doc project? This can't be undone.")) return;
    deleteMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="widget-card-shell flex h-full flex-col justify-between p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 rounded-xl bg-white/[0.05]" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4 bg-white/[0.05]" />
            <Skeleton className="h-3 w-full bg-white/[0.05]" />
          </div>
        </div>
        <div className="space-y-2 pt-2">
          <Skeleton className="h-6 w-full rounded-lg bg-white/[0.05]" />
          <Skeleton className="h-6 w-2/3 rounded-lg bg-white/[0.05]" />
        </div>
        <Skeleton className="h-9 w-full rounded-full bg-white/[0.05]" />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="widget-card-shell flex h-full items-center justify-center gap-1.5 p-4 text-center text-[12px] text-destructive border-destructive/20">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>Couldn&apos;t load project spec.</span>
      </div>
    );
  }

  // Editing reuses the creation form rather than a second, drifting copy. Before
  // this there was no way to change a spec at all once it had been saved.
  if (isEditing && canWrite) {
    return (
      <ProjectSpecForm
        heading="Edit Project Doc"
        subheading="Update tech spec & repositories"
        initial={specDraftFrom(project)}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        isPending={updateMutation.isPending}
        error={editError}
        onSubmit={(formData) => {
          setEditError(null);
          updateMutation.mutate(formData);
        }}
        onCancel={() => {
          setEditError(null);
          setIsEditing(false);
        }}
        cancelLabel="Discard"
      />
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full rounded-2xl">
        <ProjectDocCardBody project={project} slug={slug} docProjectId={docProjectId} />
      </ContextMenuTrigger>
      <ContextMenuContent>
        {canWrite && <ContextMenuItem onClick={() => setIsEditing(true)}>Edit spec</ContextMenuItem>}
        {canWrite && (
          <ContextMenuItem variant="destructive" onClick={handleDeleteProject}>
            Delete project
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
