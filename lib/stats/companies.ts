// Company leaderboards — the boards where the companies get ranked for once.
//
// Aggregated across every user who opted into the leaderboard (same gate as the
// player boards: leaderboardOptIn + publicProfile). No user is ever named here;
// a company row is a sum over many people's misery.
//
// Rate-based boards (ghost rate, response rate, speed) require a minimum sample,
// because "100% ghost rate" off a single application is noise, not a villain.

import { db } from "@/lib/db";
import type { CompanyEntry, CompanyLeaderboards } from "@/lib/types";
import { deriveStatus } from "./status";

const HOUR_MS = 3_600_000;

/** Rate boards need this many applications before a company can rank. */
const MIN_APPLICATIONS_FOR_RATE = 3;
/** Speed board needs this many actual rejections to average over. */
const MIN_REJECTIONS_FOR_SPEED = 2;

const BOARD_SIZE = 10;

/**
 * Names that are the ATS product (or the fallback's failure mode), not an
 * employer. `companyFromDomain` in the linker guesses a company from the sender
 * domain when the subject yields nothing, which is how "Greenhouse" and
 * "Myworkday" end up looking like employers. Ranking those would crown the
 * applicant-tracking vendors as the biggest ghosts in the market, which is
 * funny but wrong.
 */
const NOT_AN_EMPLOYER = new Set([
  "greenhouse",
  "lever",
  "workday",
  "myworkday",
  "ashby",
  "ashbyhq",
  "smartrecruiters",
  "smart recruiters",
  "icims",
  "comeet",
  "bamboohr",
  "bamboo hr",
  "teamtailor",
  "team tailor",
  "workable",
  "jobvite",
  "recruitee",
  "breezy",
  "breezy hr",
  "taleo",
  "linkedin",
  "indeed",
  "glassdoor",
  "unknown company",
  "no reply",
  "noreply",
  "notifications",
  // Extraction artifacts: the subject patterns occasionally grab the tail of a
  // rejection sentence ("…move forward with other candidates") instead of an
  // employer. Ranking "Candidates" as the market's biggest ghost is a bug, not
  // a hot take.
  "candidates",
  "candidate",
  "other candidates",
  "the team",
  "team",
  "careers",
  "recruiting",
  "hiring team",
]);

/**
 * Seeded demo accounts. Their companies are fictional (Globex, Dunder Mifflin),
 * and mixing them into the company boards puts Aperture Science on the same
 * ladder as Oracle. The player boards still show the demo users — that's their
 * job — but the Wall of Shame is about real employers.
 */
const DEMO_EMAIL_SUFFIX = "@demo.unemployedking.local";

interface Agg {
  display: Map<string, number>; // raw name -> times seen, for the prettiest label
  applications: number;
  ghosted: number;
  rejected: number;
  responded: number; // ever said ANYTHING back: rejection, interview, or offer
  rejectionHours: number[];
}

function emptyAgg(): Agg {
  return {
    display: new Map(),
    applications: 0,
    ghosted: 0,
    rejected: 0,
    responded: 0,
    rejectionHours: [],
  };
}

function build(
  aggs: Map<string, Agg>,
  value: (a: Agg) => number | null,
  direction: "asc" | "desc",
  round: (n: number) => number = (n) => n,
): CompanyEntry[] {
  const rows: { company: string; value: number; applications: number }[] = [];

  for (const agg of aggs.values()) {
    const v = value(agg);
    if (v === null) continue;
    if (direction === "desc" && v <= 0) continue; // a zero score is not a ranking

    // The most frequently seen spelling wins the label ("Wix" over "wix careers").
    let label = "";
    let best = -1;
    for (const [name, count] of agg.display) {
      if (count > best) {
        best = count;
        label = name;
      }
    }

    rows.push({ company: label, value: round(v), applications: agg.applications });
  }

  rows.sort((a, b) => {
    if (a.value !== b.value) return direction === "asc" ? a.value - b.value : b.value - a.value;
    // Break ties with the bigger sample, then alphabetically — deterministic.
    if (a.applications !== b.applications) return b.applications - a.applications;
    return a.company.localeCompare(b.company);
  });

  return rows.slice(0, BOARD_SIZE).map((row, i) => ({ rank: i + 1, ...row }));
}

export async function getCompanyLeaderboards(): Promise<CompanyLeaderboards> {
  const applications = await db.application.findMany({
    where: {
      user: {
        leaderboardOptIn: true,
        publicProfile: true,
        email: { not: { endsWith: DEMO_EMAIL_SUFFIX } },
      },
    },
    select: {
      company: true,
      companyNormalized: true,
      appliedAt: true,
      events: { select: { type: true, occurredAt: true } },
    },
  });

  const aggs = new Map<string, Agg>();

  for (const app of applications) {
    const key = app.companyNormalized.trim();
    if (!key || NOT_AN_EMPLOYER.has(key)) continue;

    const agg = aggs.get(key) ?? emptyAgg();
    const label = app.company.trim() || key;
    agg.display.set(label, (agg.display.get(label) ?? 0) + 1);
    agg.applications++;

    const status = deriveStatus(app.events);
    if (status === "ghosted") agg.ghosted++;
    if (status === "rejected") agg.rejected++;

    // "Responded" is about the company ever replying, not the final outcome — a
    // rejection that arrived after a ghosting still counts as them replying.
    const replied = app.events.some(
      (e) => e.type === "rejected" || e.type === "interview" || e.type === "offer",
    );
    if (replied) agg.responded++;

    // Time-to-rejection: from the application to their FIRST rejection.
    const appliedMs = Math.min(
      app.appliedAt.getTime(),
      ...app.events.filter((e) => e.type === "applied").map((e) => e.occurredAt.getTime()),
    );
    const firstRejection = app.events
      .filter((e) => e.type === "rejected" && e.occurredAt.getTime() >= appliedMs)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0];
    if (firstRejection) {
      agg.rejectionHours.push((firstRejection.occurredAt.getTime() - appliedMs) / HOUR_MS);
    }

    aggs.set(key, agg);
  }

  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const pct = (n: number) => Math.round(n * 1000) / 10; // 0..100, one decimal

  return {
    mostGhosting: build(aggs, (a) => a.ghosted, "desc"),
    mostRejecting: build(aggs, (a) => a.rejected, "desc"),
    mostApplied: build(aggs, (a) => a.applications, "desc"),
    ghostRate: build(
      aggs,
      (a) => (a.applications >= MIN_APPLICATIONS_FOR_RATE ? a.ghosted / a.applications : null),
      "desc",
      pct,
    ),
    bestResponders: build(
      aggs,
      (a) => (a.applications >= MIN_APPLICATIONS_FOR_RATE ? a.responded / a.applications : null),
      "desc",
      pct,
    ),
    fastestRejection: build(
      aggs,
      (a) => (a.rejectionHours.length >= MIN_REJECTIONS_FOR_SPEED ? mean(a.rejectionHours) : null),
      "asc",
      round1,
    ),
    minApplicationsForRate: MIN_APPLICATIONS_FOR_RATE,
  };
}
