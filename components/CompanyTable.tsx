// One company leaderboard: rank, company, right-aligned value.
//
// Unlike the player boards, nothing here links anywhere — a company is not a
// user. The application count rides along with every row so a rate is never
// shown without the sample behind it ("100% ghost rate" over 3 applications is
// a very different claim than over 40).

import type { CompanyEntry } from "@/lib/types";

interface CompanyTableProps {
  title: string;
  entries: CompanyEntry[];
  valueHeader: string;
  emptyText: string;
  formatValue?: (value: number) => string;
  footnote?: string;
}

const ROW_GRID = "grid grid-cols-[2.25rem_1fr_auto] items-center gap-x-2";

export function CompanyTable({
  title,
  entries,
  valueHeader,
  emptyText,
  formatValue = (value) => String(value),
  footnote,
}: CompanyTableProps) {
  return (
    <section className="rounded-xl border border-edge bg-surface p-4 sm:p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">{title}</h2>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">{emptyText}</p>
      ) : (
        <div className="mt-3">
          <div
            className={`${ROW_GRID} px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted`}
            aria-hidden="true"
          >
            <span>#</span>
            <span>Company</span>
            <span className="text-right">{valueHeader}</span>
          </div>
          <ol className="space-y-[3px]">
            {entries.map((entry) => (
              <li
                key={entry.company}
                className={`${ROW_GRID} rounded-lg border border-transparent px-2 py-1.5 hover:bg-white/5`}
              >
                <span className="text-sm tabular-nums text-ink-muted">{entry.rank}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {entry.company}
                  </span>
                  <span className="block text-[11px] tabular-nums text-ink-muted">
                    {entry.applications} application{entry.applications === 1 ? "" : "s"}
                  </span>
                </span>
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
