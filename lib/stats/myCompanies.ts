// Per-user company breakdown — "who ghosted ME the most".
//
// Deliberately private: this is a view over one user's own applications, shown
// only on their own dashboard. It makes no claim about how a company treats
// anyone else, which is exactly why it isn't a public leaderboard: a ranking of
// named employers built from one inbox is an accusation, not a statistic.

import { db } from "@/lib/db";
import type { CompanyTally } from "@/lib/types";
import { deriveStatus } from "./status";

/** How many rows the dashboard shows per column. */
const TOP_N = 5;

/**
 * Names that are the applicant-tracking system, not the employer. The linker
 * falls back to guessing a company from the sender domain when the subject
 * yields nothing ("Greenhouse"), and the subject patterns can grab the tail of
 * a rejection sentence ("…other candidates"). Neither is a company that ghosted
 * you.
 */
const NOT_AN_EMPLOYER = new Set([
  "greenhouse",
  "lever",
  "workday",
  "myworkday",
  "ashby",
  "ashbyhq",
  "smartrecruiters",
  "icims",
  "comeet",
  "bamboohr",
  "teamtailor",
  "workable",
  "jobvite",
  "recruitee",
  "breezy",
  "taleo",
  "linkedin",
  "indeed",
  "glassdoor",
  "unknown company",
  "no reply",
  "noreply",
  "notifications",
  "candidates",
  "candidate",
  "other candidates",
  "team",
  "the team",
  "careers",
  "recruiting",
  "hiring team",
]);

interface Tally {
  labels: Map<string, number>;
  applications: number;
  ghosted: number;
  rejected: number;
}

export interface MyCompanies {
  ghostedMe: CompanyTally[];
  rejectedMe: CompanyTally[];
  /** Companies I applied to more than once — the ones I keep going back to. */
  mostApplied: CompanyTally[];
}

function top(
  tallies: Map<string, Tally>,
  pick: (t: Tally) => number,
): CompanyTally[] {
  const rows: CompanyTally[] = [];

  for (const t of tallies.values()) {
    const value = pick(t);
    if (value <= 0) continue;

    // The spelling seen most often wins the label.
    let company = "";
    let best = -1;
    for (const [name, count] of t.labels) {
      if (count > best) {
        best = count;
        company = name;
      }
    }
    rows.push({ company, value, applications: t.applications });
  }

  rows.sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value;
    if (a.applications !== b.applications) return b.applications - a.applications;
    return a.company.localeCompare(b.company);
  });

  return rows.slice(0, TOP_N);
}

export async function getMyCompanies(userId: string): Promise<MyCompanies> {
  const applications = await db.application.findMany({
    where: { userId },
    select: {
      company: true,
      companyNormalized: true,
      events: { select: { type: true, occurredAt: true } },
    },
  });

  const tallies = new Map<string, Tally>();

  for (const app of applications) {
    const key = app.companyNormalized.trim();
    if (!key || NOT_AN_EMPLOYER.has(key)) continue;

    const t =
      tallies.get(key) ?? { labels: new Map<string, number>(), applications: 0, ghosted: 0, rejected: 0 };
    const label = app.company.trim() || key;
    t.labels.set(label, (t.labels.get(label) ?? 0) + 1);
    t.applications++;

    const status = deriveStatus(app.events);
    if (status === "ghosted") t.ghosted++;
    if (status === "rejected") t.rejected++;

    tallies.set(key, t);
  }

  return {
    ghostedMe: top(tallies, (t) => t.ghosted),
    rejectedMe: top(tallies, (t) => t.rejected),
    mostApplied: top(tallies, (t) => t.applications),
  };
}
