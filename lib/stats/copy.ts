// Profile-footer one-liners. Deterministic: the same stats always produce the
// same tagline (no Math.random at request time), but as the numbers move the
// tagline rotates. Tone per DESIGN §1: the joke is the market, not the person.

import type { ProfileStats } from "@/lib/types";

interface TaglineCandidate {
  /** Whether this line makes sense for the given stats. */
  applies: (s: ProfileStats) => boolean;
  line: (s: ProfileStats) => string;
}

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

const CANDIDATES: TaglineCandidate[] = [
  {
    applies: (s) => s.rejected > 0,
    line: (s) =>
      `${s.rejected} rejection${s.rejected === 1 ? "" : "s"} and still refreshing the inbox. That's not desperation, that's cardio.`,
  },
  {
    applies: (s) => s.ghosted > 0,
    line: (s) =>
      `Ghosted ${s.ghosted} time${s.ghosted === 1 ? "" : "s"}. Even the spam folder writes back more often.`,
  },
  {
    applies: (s) => s.responseRate !== null && s.applied >= 5,
    line: (s) =>
      `Response rate: ${percent(s.responseRate ?? 0)}. Casinos have better odds, and free drinks.`,
  },
  {
    applies: (s) => s.offers > 0,
    line: () => "Has an actual offer and is STILL checking the leaderboard. Respect.",
  },
  {
    applies: (s) => s.interviews === 0 && s.applied >= 10,
    line: () => "Zero interviews so far. The funnel is more of a wall, really.",
  },
  {
    applies: (s) => s.fastestRejectionHours !== null && s.fastestRejectionHours <= 24,
    line: (s) =>
      `Once rejected in ${s.fastestRejectionHours}h. They didn't even pretend to read the resume.`,
  },
  {
    applies: () => true,
    line: (s) => `Level ${s.rejectionLevel} ${s.levelTitle}. The parents are so proud.`,
  },
  {
    applies: (s) => s.applied >= 20,
    line: (s) => `${s.applied} applications. At this point it's not a search, it's a lifestyle.`,
  },
  {
    applies: (s) => s.ghostRate !== null && s.ghostRate >= 0.5,
    line: () => "Over half these applications are haunted. Bring a priest.",
  },
  {
    applies: (s) => s.rejected === 0 && s.applied > 0,
    line: () => "No rejections yet. Statistically suspicious. Aim higher.",
  },
  {
    applies: () => true,
    line: () => "Every 'unfortunately' makes this profile stronger. Basically unstoppable now.",
  },
  {
    applies: (s) => s.pending > 0,
    line: (s) =>
      `${s.pending} application${s.pending === 1 ? "" : "s"} "under review". Sure they are.`,
  },
  {
    applies: (s) => s.currentStreakWeeks >= 2,
    line: (s) =>
      `${s.currentStreakWeeks} straight weeks with a rejection. Streaks build character.`,
  },
];

/** Deterministic hash of the stats that drive rotation. */
function hashStats(s: ProfileStats): number {
  const parts = [
    s.applied,
    s.rejected,
    s.ghosted,
    s.interviews,
    s.offers,
    s.pending,
    s.rejectionLevel,
    s.currentStreakWeeks,
    s.badges.length,
  ];
  let hash = 2166136261; // FNV-1a style mix over the stat values
  for (const part of parts) {
    hash ^= Math.trunc(Number.isFinite(part) ? part : 0) & 0xffff;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Pick one applicable one-liner, deterministically keyed on the stats.
 * Same stats → same line; new rejections rotate the misery.
 */
export function funnyTagline(stats: ProfileStats): string {
  const eligible = CANDIDATES.filter((c) => c.applies(stats));
  // At least two candidates are unconditional, so `eligible` is never empty.
  const chosen = eligible[hashStats(stats) % eligible.length];
  return chosen.line(stats);
}
