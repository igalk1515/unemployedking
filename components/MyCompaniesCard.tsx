// "Your personal wall of shame" — which companies ghosted or rejected YOU most.
//
// Dashboard-only, private to the owner of the data. Every number here is a fact
// about this user's own inbox, not a verdict on how a company treats the world.

import type { CompanyTally } from "@/lib/types";

interface Column {
  title: string;
  emoji: string;
  entries: CompanyTally[];
  valueLabel: string;
  emptyText: string;
}

function CompanyColumn({ title, emoji, entries, valueLabel, emptyText }: Column) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-2">
        <span aria-hidden="true">{emoji}</span> {title}
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">{emptyText}</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {entries.map((entry, i) => (
            <li
              key={entry.company}
              className="grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-x-2 rounded-lg px-1.5 py-1 hover:bg-white/5"
            >
              <span className="text-xs tabular-nums text-ink-muted">{i + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{entry.company}</span>
                <span className="block text-[11px] tabular-nums text-ink-muted">
                  {entry.applications} application{entry.applications === 1 ? "" : "s"}
                </span>
              </span>
              <span className="text-right text-sm font-semibold tabular-nums text-ink-2">
                {entry.value}
                <span className="ml-1 text-[11px] font-normal text-ink-muted">{valueLabel}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function MyCompaniesCard({
  ghostedMe,
  rejectedMe,
  mostApplied,
}: {
  ghostedMe: CompanyTally[];
  rejectedMe: CompanyTally[];
  mostApplied: CompanyTally[];
}) {
  const empty =
    ghostedMe.length === 0 && rejectedMe.length === 0 && mostApplied.length === 0;

  return (
    <section
      aria-label="Your companies"
      className="mt-6 rounded-xl border border-edge bg-surface p-4 sm:p-5"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
        🏢 Your personal wall of shame
      </h2>
      <p className="mt-1 text-xs text-ink-muted">
        Who did this to you, ranked. Private to you — nobody else sees this, and
        it says nothing about how these companies treat anyone else.
      </p>

      {empty ? (
        <p className="mt-4 text-sm text-ink-muted">
          Nothing to show yet. Sync your inbox and the culprits will line up on
          their own.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <CompanyColumn
            emoji="👻"
            title="Ghosted you most"
            entries={ghostedMe}
            valueLabel="ghosts"
            emptyText="Nobody has ghosted you. Genuinely suspicious."
          />
          <CompanyColumn
            emoji="💀"
            title="Rejected you most"
            entries={rejectedMe}
            valueLabel="L's"
            emptyText="No rejections on record. Yet."
          />
          <CompanyColumn
            emoji="📨"
            title="You applied to most"
            entries={mostApplied}
            valueLabel="apps"
            emptyText="No applications tracked yet."
          />
        </div>
      )}
    </section>
  );
}
