// One leaderboard: rank, name (link to profile), right-aligned tabular value.
// The king row wears a --gold border + 👑 (DESIGN §4.6).

import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/types";

interface LeaderboardTableProps {
  title: string;
  entries: LeaderboardEntry[];
  valueHeader: string;
  emptyText: string;
  formatValue?: (value: number) => string;
  footnote?: string;
}

const ROW_GRID = "grid grid-cols-[2.25rem_1fr_auto] items-center gap-x-2";

export function LeaderboardTable({
  title,
  entries,
  valueHeader,
  emptyText,
  formatValue = (value) => String(value),
  footnote,
}: LeaderboardTableProps) {
  return (
    <section className="rounded-xl border border-edge bg-surface p-4 sm:p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
        {title}
      </h2>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">{emptyText}</p>
      ) : (
        <div className="mt-3">
          <div
            className={`${ROW_GRID} px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted`}
            aria-hidden="true"
          >
            <span>#</span>
            <span>Who</span>
            <span className="text-right">{valueHeader}</span>
          </div>
          <ol className="space-y-[3px]">
            {entries.map((entry) => (
              <li
                key={entry.slug}
                className={
                  entry.isKing
                    ? `${ROW_GRID} rounded-lg border border-gold bg-gold/10 px-2 py-1.5`
                    : `${ROW_GRID} rounded-lg border border-transparent px-2 py-1.5 hover:bg-white/5`
                }
              >
                <span className="text-sm tabular-nums text-ink-muted">
                  {entry.rank}
                </span>
                <Link
                  href={`/u/${entry.slug}`}
                  className="truncate text-sm font-medium text-ink transition-colors hover:text-gold"
                >
                  {entry.isKing ? (
                    <span role="img" aria-label="current Unemployed King">
                      👑{" "}
                    </span>
                  ) : null}
                  {entry.displayName}
                </Link>
                <span className="text-right text-sm font-semibold tabular-nums text-ink-2">
                  {formatValue(entry.value)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {footnote ? <p className="mt-3 text-xs text-ink-muted">{footnote}</p> : null}
    </section>
  );
}
