"use client";

import { Trash2 } from "lucide-react";

const CARD_COLORS = [
  { label: "Default", value: undefined },
  { label: "Blue", value: "#2563EB" },
  { label: "Green", value: "#10B981" },
  { label: "Amber", value: "#F59E0B" },
  { label: "Purple", value: "#8B5CF6" },
  { label: "Rose", value: "#F43F5E" },
];

interface NoteCardChipProps {
  bgColor: string | undefined;
  onBgColorChange: (color: string | undefined) => void;
  onDelete: () => void;
}

/** Card-level settings (background colour, delete) — not text formatting, so
 *  they stay in the slot above the card while text formatting follows the
 *  selection (NoteBubbleMenu) and the caret (the `/` menu). */
export function NoteCardChip({ bgColor, onBgColorChange, onDelete }: NoteCardChipProps) {
  return (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/[0.08] bg-[#131314]/95 px-3 py-1.5 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-0.5">
        {CARD_COLORS.map((c) => (
          <button
            key={c.label}
            type="button"
            title={`${c.label} card`}
            aria-label={`${c.label} card background`}
            onClick={() => onBgColorChange(c.value)}
            className={`h-4 w-4 shrink-0 cursor-pointer rounded-full ring-1 ${
              bgColor === c.value ? "ring-2 ring-white/60" : "ring-white/10"
            }`}
            style={{ backgroundColor: c.value ?? "#131314" }}
          />
        ))}
      </div>

      <div className="mx-0.5 h-4 w-px bg-white/[0.08]" />

      <button
        type="button"
        onClick={onDelete}
        title="Delete note"
        aria-label="Delete note"
        className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
