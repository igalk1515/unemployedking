// The throne. Shows this week's Unemployed King — or the vacancy notice.

import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/types";

interface CrownCardProps {
  king: LeaderboardEntry | null;
  /** e.g. "the week of Jul 6" */
  weekLabel: string;
}

export function CrownCard({ king, weekLabel }: CrownCardProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-gold bg-surface p-6 sm:p-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(250,178,25,0.12),transparent_55%)]"
      />
      {king ? (
        <div className="relative flex flex-col items-center gap-3 text-center sm:flex-row sm:gap-6 sm:text-left">
          <span aria-hidden="true" className="text-6xl leading-none">
            👑
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              This week&apos;s Unemployed King
            </p>
            <Link
              href={`/u/${king.slug}`}
              className="mt-1 block truncate text-3xl font-extrabold tracking-tight text-ink transition-colors hover:text-gold"
            >
              {king.displayName}
            </Link>
            <p className="mt-1.5 text-sm text-ink-2">
              <span className="font-bold tabular-nums text-red">
                <span aria-hidden="true">💀</span> {king.value} rejection
                {king.value === 1 ? "" : "s"}
              </span>{" "}
              in {weekLabel}. Long may they lose.
            </p>
          </div>
        </div>
      ) : (
        <div className="relative flex flex-col items-center gap-3 text-center sm:flex-row sm:gap-6 sm:text-left">
          <span aria-hidden="true" className="text-6xl leading-none opacity-50">
            👑
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              The throne sits empty
            </p>
            <p className="mt-1 text-xl font-bold text-ink">
              Nobody was rejected in {weekLabel}. Yet.
            </p>
            <p className="mt-1.5 text-sm text-ink-muted">
              Apply somewhere. Get told no. Claim the crown.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
