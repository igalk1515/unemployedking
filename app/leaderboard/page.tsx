// /leaderboard — the ladder itself. Weekly crown, weekly ghostings, all-time
// rejections, and the applied→rejected speedrun (lower is better, somehow).

import type { Metadata } from "next";
import { getLeaderboards } from "@/lib/stats/leaderboard";
import { CrownCard } from "@/components/CrownCard";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { formatDayUTC, formatHours } from "@/components/format";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "The competitive rejection ladder. Most rejected this week wins the crown.",
};

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const boards = await getLeaderboards();
  const weekLabel = `the week of ${formatDayUTC(boards.weekStartUtc)}`;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          The Ladder
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          Resets Monday 00:00 UTC. Most rejected wins. Yes, wins.{" "}
          <span className="text-ink-muted">Currently {weekLabel}.</span>
        </p>
      </header>

      <div className="mt-6">
        <CrownCard king={boards.king} weekLabel={weekLabel} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LeaderboardTable
          title="💀 Rejections this week"
          entries={boards.weeklyRejected}
          valueHeader="L's"
          emptyText="Nobody has been rejected this week. Everyone must be resting."
        />
        <LeaderboardTable
          title="👻 Ghostings this week"
          entries={boards.weeklyGhosted}
          valueHeader="Ghosts"
          emptyText="Zero ghostings this week. Recruiters suddenly have manners."
        />
        <LeaderboardTable
          title="🪦 Rejections all time"
          entries={boards.allTimeRejected}
          valueHeader="Career L's"
          emptyText="No rejections recorded, ever. Either we just launched or the market healed."
        />
        <LeaderboardTable
          title="⚡ Speedrun: applied → rejected"
          entries={boards.speedrun}
          valueHeader="Time"
          formatValue={formatHours}
          emptyText="No speedruns on the books. Someone apply somewhere terrible, quick."
          footnote="Lower is better. Somehow."
        />
      </div>

      <p className="mt-8 text-center text-xs text-ink-muted">
        Only players who opted into the leaderboard appear here. The rest
        suffer privately, which is also valid.
      </p>
    </main>
  );
}
