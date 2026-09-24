const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
];

/** "3 min. ago", "yesterday" — for notification and comment timestamps. Reads
 *  a timestamptz ISO string, so there's no server-offset skew (see AGENTS §12). */
export function timeAgo(iso: string, now = Date.now()): string {
  let value = Math.round((new Date(iso).getTime() - now) / 1000);
  // Everything shown here happened in the past. A future value means the
  // viewer's clock is behind the server's (or an optimistic comment is a few
  // ms ahead) — "now" is the honest reading, never "in 3 hr".
  if (value > 0) value = 0;
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return formatter.format(value, unit);
    value = Math.round(value / size);
  }
  return formatter.format(value, "year");
}
