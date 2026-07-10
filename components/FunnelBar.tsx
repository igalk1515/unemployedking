// One funnel row: thin horizontal bar (≤28px tall, 4px rounded ends) in the
// ordinal blue ramp, with a direct value label in --ink-2 — the text never
// wears the bar color (DESIGN §4.6). Stack rows with a 2px gap.

const RAMP: Record<1 | 2 | 3 | 4, string> = {
  1: "var(--ramp-1)",
  2: "var(--ramp-2)",
  3: "var(--ramp-3)",
  4: "var(--ramp-4)",
};

interface FunnelBarProps {
  emoji: string;
  label: string;
  value: number;
  /** Largest value in the funnel — bars scale relative to this. */
  max: number;
  /** Funnel depth 1 (widest/lightest) → 4 (deepest/darkest). */
  step: 1 | 2 | 3 | 4;
}

export function FunnelBar({ emoji, label, value, max, step }: FunnelBarProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  // Zero still renders a 2px sliver so the stage visibly exists (and flopped).
  const width = value > 0 ? `${Math.max(pct, 1.5)}%` : "2px";

  return (
    <div className="grid grid-cols-[minmax(6.5rem,10rem)_1fr_3.25rem] items-center gap-x-3">
      <span className="truncate text-sm text-ink-2">
        <span aria-hidden="true">{emoji}</span> {label}
      </span>
      <div className="h-5">
        <div
          className="h-5 rounded-[4px]"
          style={{ width, backgroundColor: RAMP[step] }}
        />
      </div>
      <span className="text-right text-sm tabular-nums text-ink-2">
        {value}
      </span>
    </div>
  );
}
