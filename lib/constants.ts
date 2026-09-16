import type { TaskStatus } from "@/lib/db";

/** The board's three fixed columns, in canonical left-to-right order. There is
 *  no sections table — every task carries a `status`, and the board is just
 *  that status filtered by date. */
export const STATUS_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "completed", label: "Completed" },
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  completed: "Completed",
};

/**
 * Work types are a plain `text` column (see lib/db.ts), not a pg enum, so this
 * list is the single source of truth — add a new type here, no migration
 * needed. Colors reuse the existing Google-palette chart tokens from
 * globals.css rather than introducing new ones.
 */
export const WORK_TYPES = [
  { value: "bug", label: "Bug", color: "#f28b82" },
  { value: "feature", label: "Feature", color: "#81c995" },
  { value: "story", label: "Story", color: "#fdd663" },
  { value: "task", label: "Task", color: "#8ab4f8" },
] as const;
export type WorkType = (typeof WORK_TYPES)[number]["value"];

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  bug: "Bug",
  feature: "Feature",
  story: "Story",
  task: "Task",
};

export const PROJECTS = ["Rafttaar", "Creonex", "BellCorps", "Other"] as const;
export type Project = (typeof PROJECTS)[number];

export const CATEGORIES = [
  "Code",
  "Analysis",
  "Meeting",
  "Design",
  "Debugging",
] as const;
export type Category = (typeof CATEGORIES)[number];


export const MIN_SUMMARY_LENGTH = 10;


export function isFillerSummary(summary: string): boolean {
  const normalized = summary.trim().toLowerCase();
  return (
    normalized.length < MIN_SUMMARY_LENGTH
  );
}

/** Predefined pin colors — the only choices the landmark UI offers (draft form
 *  swatches, right-click → Change colour), so every landmark stays on-palette.
 *
 *  Lives OUTSIDE lib/actions/landmarks.ts because a "use server" file may only
 *  export async functions — both the server actions (colour validation) and
 *  the client widgets (swatch rendering) need this list. */
export const LANDMARK_COLORS = [
  { label: "Red", value: "#EA4335" },
  { label: "Blue", value: "#4285F4" },
  { label: "Green", value: "#34A853" },
  { label: "Yellow", value: "#FBBC04" },
  { label: "Purple", value: "#A142F4" },
  { label: "Orange", value: "#FF6D01" },
  { label: "Teal", value: "#12B5CB" },
  { label: "Pink", value: "#F42F71" },
] as const;
