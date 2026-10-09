/**
 * The one place that answers "how big is this widget, and how far can it go".
 *
 * The model is the one every canvas tool uses (Figma frames, tldraw shapes):
 * a widget's stored width and height ARE its size. Nothing measures content to
 * decide it and nothing infers it from the widget's type at render time —
 * content that doesn't fit scrolls inside the card. That keeps a size the same
 * before and after a move, a content edit, a save and a reload.
 *
 * Pure data and functions with no React or DB imports, so the canvas and the
 * server actions read the same numbers.
 */

export type WidgetSize = { width: number; height: number };

type SizeSpec = {
  /** The size a new widget is created at. */
  default: WidgetSize;
  /** A widget that opens as a form and settles into a smaller card sets this
   *  size once when the form completes. Also the fallback for rows saved before
   *  sizes were always stored. */
  settled?: WidgetSize;
  min: WidgetSize;
  max: WidgetSize;
  /** False = no resize handles; the size only changes through `resizeWidget`. */
  resizable: boolean;
};

/** Absolute bounds, whatever the type — matches what the server always allowed. */
export const ABSOLUTE_MIN_SIZE = 80;
export const ABSOLUTE_MAX_SIZE = 4000;

const MAX_RESIZE: WidgetSize = { width: 2400, height: 2400 };
/** Fixed-size types never use min/max; this just keeps the table total. */
const FIXED_LIMITS = { min: { width: ABSOLUTE_MIN_SIZE, height: ABSOLUTE_MIN_SIZE }, max: MAX_RESIZE, resizable: false };

const FALLBACK_SPEC: SizeSpec = {
  default: { width: 340, height: 320 },
  min: { width: 160, height: 100 },
  max: MAX_RESIZE,
  resizable: true,
};

/** Draft forms are laid out to fit these sizes, so the form is fully visible
 *  the moment a widget is dropped. */
export const WIDGET_SIZES: Record<string, SizeSpec> = {
  // Pinned cards that own an internal scroll area.
  board: { default: { width: 1180, height: 660 }, ...FIXED_LIMITS },
  "mail-summary": { default: { width: 340, height: 420 }, ...FIXED_LIMITS },

  markdown: { default: { width: 340, height: 240 }, min: { width: 160, height: 100 }, max: MAX_RESIZE, resizable: true },
  media: { default: { width: 360, height: 280 }, min: { width: 120, height: 90 }, max: MAX_RESIZE, resizable: true },
  // The draft/edit form is ~460px tall; the saved card is a compact summary.
  "project-doc": {
    default: { width: 320, height: 460 },
    settled: { width: 320, height: 240 },
    min: { width: 240, height: 160 },
    max: MAX_RESIZE,
    resizable: true,
  },

  // One size for the draft form and the saved card, so saving never resizes.
  bookmark: { default: { width: 380, height: 140 }, ...FIXED_LIMITS },
  gallery: { default: { width: 220, height: 250 }, ...FIXED_LIMITS },
  code: { default: { width: 320, height: 150 }, ...FIXED_LIMITS },

  // Draft form → pin. The pin is a marker on the canvas, not a card.
  landmark: { default: { width: 300, height: 400 }, settled: { width: 190, height: 220 }, ...FIXED_LIMITS },
};

function specFor(type: string): SizeSpec {
  return WIDGET_SIZES[type] ?? FALLBACK_SPEC;
}

export function defaultSize(type: string): WidgetSize {
  return { ...specFor(type).default };
}

/** The size a widget settles at when its creation form completes. */
export function settledSize(type: string): WidgetSize {
  return { ...(specFor(type).settled ?? specFor(type).default) };
}

export function isResizable(type: string): boolean {
  return specFor(type).resizable;
}

export function resizeLimits(type: string): { min: WidgetSize; max: WidgetSize } {
  const spec = specFor(type);
  return { min: { ...spec.min }, max: { ...spec.max } };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Pulls a requested size inside the type's limits. Resizable types use their
 *  own min/max; fixed-size types only get the absolute bounds, because their
 *  size is set by `resizeWidget` (a draft settling), not dragged. */
export function clampSize(type: string, size: WidgetSize): WidgetSize {
  const spec = specFor(type);
  const min = spec.resizable ? spec.min : { width: ABSOLUTE_MIN_SIZE, height: ABSOLUTE_MIN_SIZE };
  const max = spec.resizable ? spec.max : { width: ABSOLUTE_MAX_SIZE, height: ABSOLUTE_MAX_SIZE };
  return { width: clamp(size.width, min.width, max.width), height: clamp(size.height, min.height, max.height) };
}

/** A stored row's size. Rows written before sizes were always stored have a
 *  null height; they fall back to the type's settled size. */
export function storedSize(type: string, width: number, height: number | null | undefined): WidgetSize {
  if (height == null) return { width, height: settledSize(type).height };
  return { width, height };
}
