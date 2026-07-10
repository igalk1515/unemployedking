// KPI tile: emoji + word label (never color alone), big tabular-nums figure.

interface StatTileProps {
  emoji: string;
  label: string;
  value: string | number;
  /** Tailwind text color class for the value; defaults to plain ink. */
  accent?: string;
  sub?: string;
}

export function StatTile({
  emoji,
  label,
  value,
  accent = "text-ink",
  sub,
}: StatTileProps) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-muted">
        <span aria-hidden="true">{emoji}</span> {label}
      </div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${accent}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-ink-muted">{sub}</div> : null}
    </div>
  );
}
