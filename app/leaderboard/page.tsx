// /leaderboard — the ladder itself. Weekly crown, weekly ghostings, all-time
// rejections, and the applied→rejected speedrun (lower is better, somehow).
// Then the other half: the companies, ranked for once.

import type { Metadata } from "next";
import { getLeaderboards } from "@/lib/stats/leaderboard";
import { getCompanyLeaderboards } from "@/lib/stats/companies";
import { CompanyTable } from "@/components/CompanyTable";
import { CrownCard } from "@/components/CrownCard";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { formatDayUTC, formatHours } from "@/components/format";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "The competitive rejection ladder. Most rejected this week wins the crown. Plus the companies doing the ghosting.",
};

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const [boards, companies] = await Promise.all([
    getLeaderboards(),
    getCompanyLeaderboards(),
  ]);
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

      {/* The other side of the ladder: the companies get counted too. */}
      <section aria-labelledby="the-black-hole" className="mt-12">
        <h2
          id="the-black-hole"
          className="text-2xl font-extrabold tracking-tight sm:text-3xl"
        >
          🕳️ The Black Hole
        </h2>
        <p className="mt-2 text-sm text-ink-2">
          Where the applications went. Totals across everyone on the ladder — no
          applicant is ever named.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CompanyTable
            title="👻 Ghosted the most"
            entries={companies.mostGhosting}
            valueHeader="Ghosted"
            emptyText="No ghostings on record. Suspicious."
            footnote="Applications that went silent for 30 days. They never even said no."
          />
          <CompanyTable
            title="💀 Rejected the most"
            entries={companies.mostRejecting}
            valueHeader="Rejections"
            emptyText="Nobody has been rejected yet. Enjoy it while it lasts."
            footnote="At least they answered. That is the low bar we are working with."
          />
          <CompanyTable
            title="⚡ Fastest to say no"
            entries={companies.fastestRejection}
            valueHeader="Avg time"
            formatValue={formatHours}
            emptyText="Not enough rejections to time anyone yet."
            footnote="Mean time from application to rejection. Brutal, but at least it is quick."
          />
          <CompanyTable
            title="📨 Most applied to"
            entries={companies.mostApplied}
            valueHeader="Applications"
            emptyText="No applications tracked yet."
            footnote="Where everyone is throwing their CV. Popularity is not endorsement."
          />
        </div>

        {/* The sample, stated plainly. A count without its denominator is a rumour. */}
        <p className="mt-4 text-xs text-ink-muted">
          Counted from{" "}
          <span className="font-semibold text-ink-2">
            {companies.totalApplications.toLocaleString()} applications
          </span>{" "}
          across {companies.totalCompanies.toLocaleString()} companies, tracked
          by the people using this app. These are counts of what happened to
          those applications — not a measure of how a company treats everyone
          else, and not a rate. A small sample is not a verdict.
        </p>
      </section>

      <p className="mt-8 text-center text-xs text-ink-muted">
        Only players who opted into the leaderboard appear here, and only their
        data feeds the company boards. The rest suffer privately, which is also
        valid.
      </p>
    </main>
  );
}
