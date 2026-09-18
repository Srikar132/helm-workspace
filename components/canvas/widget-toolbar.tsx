"use client";

import { useDraggable } from "@dnd-kit/core";
import { Bookmark, Code2, FolderGit2, Images, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AddableWidgetType {
  type: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const ADDABLE_WIDGET_TYPES: AddableWidgetType[] = [
  { type: "markdown", label: "Note", icon: NotebookPen },
  { type: "project-doc", label: "Project Doc", icon: FolderGit2 },
  { type: "bookmark", label: "Bookmark", icon: Bookmark },
  { type: "gallery", label: "Gallery", icon: Images },
  { type: "code", label: "Code", icon: Code2 },
];

interface ToolbarItemProps extends AddableWidgetType {
  disabled: boolean;
  onAdd: (type: string) => void;
}

function ToolbarItem({ type, label, icon: Icon, disabled, onAdd }: ToolbarItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `toolbar-${type}`,
    data: { widgetType: type },
    disabled,
  });

  return (
    <Button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      title={`Tap to add ${label}, or drag onto canvas`}
      aria-label={`Add a ${label}`}
      disabled={disabled}
      variant={isDragging ? "secondary" : "ghost"}
      size="icon-sm"
      shape="rounded"
      onClick={() => onAdd(type)}
      style={{ WebkitTouchCallout: "none" }}
      className={`touch-manipulation text-zinc-400 hover:bg-white/10 hover:text-white transition-all ${
        isDragging ? "cursor-grabbing bg-white/20 text-white ring-2 ring-white/30" : "cursor-grab"
      }`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

/** Drag icon: rendered inside <DragOverlay>, follows the cursor. */
export function ToolbarDragGhost({ type }: { type: string }) {
  const widget = ADDABLE_WIDGET_TYPES.find((t) => t.type === type);
  if (!widget) return null;
  const Icon = widget.icon;
  return (
    <div className="flex h-8.5 w-8.5 items-center justify-center rounded-[10px] border border-white/30 bg-zinc-900 text-white shadow-2xl ring-2 ring-white/20">
      <Icon className="h-4 w-4" />
    </div>
  );
}

interface WidgetToolbarProps {
  canWrite: boolean;
  onAdd: (type: string) => void;
}

/** Screen-fixed vertical right-edge widget creation dock (Slightly narrower, compact width) */
export function WidgetToolbar({ canWrite, onAdd }: WidgetToolbarProps) {
  if (!canWrite) return null;

  return (
    <div className="pointer-events-none fixed inset-y-4 right-4 z-20 flex items-center">
      <div className="pointer-events-auto flex max-h-full flex-col gap-1 overflow-y-auto scrollbar-none rounded-[14px] border border-white/10 bg-zinc-900/90 p-1 shadow-2xl backdrop-blur-md">
        {ADDABLE_WIDGET_TYPES.map((widget) => (
          <ToolbarItem key={widget.type} {...widget} disabled={!canWrite} onAdd={onAdd} />
        ))}
      </div>
    </div>
  );
}
