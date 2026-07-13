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

  // A correction channel only helps if someone actually reads it, so we render
  // it exclusively when a real address is configured. CORRECTIONS_EMAIL lets you
  // publish an alias instead of the owner's personal inbox; OWNER_EMAIL is the
  // fallback. Neither set => no promise of a channel that doesn't exist.
  const contactEmail =
    process.env.CORRECTIONS_EMAIL ?? process.env.OWNER_EMAIL ?? null;

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

      {/* The other side of the ladder: the companies get counted too.
       *
       * Every label here reports what this app OBSERVED, not what a company
       * DID. "No reply detected" is a true statement about our data; "ghosted"
       * is a verdict on the company, and our detection is automated, sampled,
       * and fallible — we cannot see a phone call, and the classifier can miss
       * a reply. Same numbers, a claim we can actually stand behind. */}
      <section aria-labelledby="the-black-hole" className="mt-12">
        <h2
          id="the-black-hole"
          className="text-2xl font-extrabold tracking-tight sm:text-3xl"
        >
          🕳️ The Black Hole
        </h2>
        <p className="mt-2 text-sm text-ink-2">
          Where the applications went. What our users&apos; inboxes recorded —
          not a rating of any company. No applicant is ever named.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CompanyTable
            title="👻 Most applications with no reply"
            entries={companies.mostGhosting}
            valueHeader="No reply"
            emptyText="Every application got an answer. Genuinely unheard of."
            footnote="Applications where no response was detected within 30 days. Replies by phone, or to another address, are invisible to us."
          />
          <CompanyTable
            title="💀 Most rejections sent"
            entries={companies.mostRejecting}
            valueHeader="Rejections"
            emptyText="No rejections recorded yet. Enjoy it while it lasts."
            footnote="They answered. That is the low bar we are working with, and they cleared it."
          />
          <CompanyTable
            title="⚡ Quickest to answer (with a no)"
            entries={companies.fastestRejection}
            valueHeader="Avg time"
            formatValue={formatHours}
            emptyText="Not enough rejections to time anyone yet."
            footnote="Mean time from application to rejection. Brutal, but fast beats silence."
          />
          <CompanyTable
            title="📨 Most applied to"
            entries={companies.mostApplied}
            valueHeader="Applications"
            emptyText="No applications tracked yet."
            footnote="Where everyone is throwing their CV. Popularity is not endorsement."
          />
        </div>

        {/* Methodology, stated plainly. Disclosed facts + a visible sample turn a
         * bare accusation into a qualified, checkable observation. */}
        <div className="mt-4 rounded-lg border border-edge bg-surface/60 px-3 py-2.5 text-xs text-ink-muted">
          <p>
            <span className="font-semibold text-ink-2">How this is counted.</span>{" "}
            From{" "}
            <span className="font-semibold text-ink-2">
              {companies.totalApplications.toLocaleString()} applications
            </span>{" "}
            across {companies.totalCompanies.toLocaleString()} companies,
            self-reported by the people using this app from their own inboxes.
            &ldquo;No reply&rdquo; means our automated classifier detected no
            response within 30 days — it cannot see phone calls, texts, or mail
            sent elsewhere, and it can miss a reply it fails to recognise.
          </p>
          <p className="mt-1.5">
            These are counts from a small, self-selected sample. They are not a
            measure of how any company treats applicants generally, and they are
            not a rate.
            {contactEmail ? (
              <>
                {" "}
                <span className="text-ink-2">
                  Company here and think the data is wrong? Tell us and we will
                  correct or remove it:{" "}
                </span>
                <a
                  href={`mailto:${contactEmail}?subject=Company%20data%20correction`}
                  className="font-medium text-ink-2 underline decoration-edge underline-offset-2 hover:text-gold"
                >
                  {contactEmail}
                </a>
              </>
            ) : null}
          </p>
        </div>
      </section>

      <p className="mt-8 text-center text-xs text-ink-muted">
        Only players who opted into the leaderboard appear here, and only their
        data feeds the company boards. The rest suffer privately, which is also
        valid.
      </p>
    </main>
  );
}
