// Badge computation. Pure function — callers (lib/stats/profile.ts) assemble
// the input from the event log. All 9 badges from DESIGN.md §4.5.

import type { Badge } from "@/lib/types";

/** Aggregated event facts needed to award badges. */
export interface BadgeInput {
  /** Total applications. */
  applications: number;
  /** Total `rejected` events (orphans included). */
  rejections: number;
  /** Total `ghosted` events (orphans included). */
  ghosted: number;
  /** Total `interview` events. */
  interviews: number;
  /** Total `offer` events. */
  offers: number;
  /** Fastest same-application applied→rejected gap, in hours. Null if none. */
  fastestRejectionHours: number | null;
  /** Applications where a `rejected` event arrived AFTER a `ghosted` event. */
  necromancerCases: number;
  /** Longest run of consecutive ISO weeks with ≥1 rejection (ever). */
  longestRejectionStreakWeeks: number;
}

const GHOST_TIERS = [
  { min: 50, label: "Tier 3: Full Poltergeist" },
  { min: 25, label: "Tier 2: Séance Host" },
  { min: 10, label: "Tier 1: Ghost Whisperer" },
] as const;

/**
 * Returns the badges earned for the given facts, in a stable display order.
 * Unearned badges are omitted.
 */
export function computeBadges(input: BadgeInput): Badge[] {
  const badges: Badge[] = [];

  if (input.rejections >= 1) {
    badges.push({
      id: "first-blood",
      name: "First Blood",
      emoji: "🩸",
      description:
        "Took your first rejection. The market has officially acknowledged your existence.",
    });
  }

  if (input.ghosted >= 10) {
    const tier = GHOST_TIERS.find((t) => input.ghosted >= t.min) ?? GHOST_TIERS[2];
    badges.push({
      id: "ghost-whisperer",
      name: "Ghost Whisperer",
      emoji: "👻",
      description: `Ghosted ${input.ghosted} times (${tier.label}; tiers at 10 / 25 / 50). The silence speaks volumes.`,
    });
  }

  if (input.fastestRejectionHours !== null && input.fastestRejectionHours <= 24) {
    badges.push({
      id: "speedrunner",
      name: "Speedrunner",
      emoji: "⚡",
      description:
        "Rejected within 24 hours of applying. They really made time for you.",
    });
  }

  if (input.fastestRejectionHours !== null && input.fastestRejectionHours <= 1) {
    badges.push({
      id: "any-percent",
      name: "Any% World Record",
      emoji: "🏁",
      description:
        "Applied → rejected in under an hour. That's a personal best. Frame it.",
    });
  }

  if (input.necromancerCases >= 1) {
    badges.push({
      id: "necromancer",
      name: "Necromancer",
      emoji: "🧟",
      description:
        "A rejection rose from the dead: they ghosted you, then came back weeks later just to say no.",
    });
  }

  if (input.applications >= 50) {
    badges.push({
      id: "serial-applicant",
      name: "Serial Applicant",
      emoji: "📮",
      description: `${input.applications} applications and counting. The Easy Apply button fears you.`,
    });
  }

  if (input.longestRejectionStreakWeeks >= 4) {
    badges.push({
      id: "iron-streak",
      name: "Iron Streak",
      emoji: "🛡️",
      description: `${input.longestRejectionStreakWeeks} consecutive weeks with at least one rejection. Consistency is everything.`,
    });
  }

  if (input.interviews >= 1) {
    badges.push({
      id: "got-an-interview",
      name: "Wait, An Interview?",
      emoji: "🎯",
      description: "An actual human wants to talk to you. Don't blow it.",
    });
  }

  if (input.offers >= 1) {
    badges.push({
      id: "the-chosen-one",
      name: "The Chosen One",
      emoji: "🏆",
      description: "You have an offer. What are you still doing here?",
    });
  }

  return badges;
}
