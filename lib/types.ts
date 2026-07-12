// Shared domain vocabulary. Every module speaks these types — do not redefine
// them locally. Application status is DERIVED from events (see lib/stats).

export type EventType = "applied" | "rejected" | "ghosted" | "interview" | "offer";
export type EventSource = "email" | "manual" | "system";
export type Confidence = "high" | "medium" | "low";
export type ApplicationStatus = EventType;

/**
 * Fields a user can individually hide from their public profile. Stable keys —
 * stored comma-joined in `User.hiddenProfileFields`, gated on `/u/[slug]` (page,
 * OG image, and metadata). Note: hiding a field affects your profile + share
 * card only; leaderboard visibility is governed separately by leaderboardOptIn.
 */
export const HIDEABLE_PROFILE_FIELDS = [
  "applied",
  "rejected",
  "ghosted",
  "interviews",
  "offers",
  "funnel",
  "fastestRejection",
  "avgDaysToRejection",
  "longestGhost",
  "badges",
  "tombstones",
] as const;

export type HideableProfileField = (typeof HIDEABLE_PROFILE_FIELDS)[number];

export type ProfileFieldGroup = "Career totals" | "Time records" | "Sections";

/** Display metadata (label + emoji + UI group) for each hideable field. */
export const HIDEABLE_PROFILE_FIELD_META: Record<
  HideableProfileField,
  { label: string; emoji: string; group: ProfileFieldGroup }
> = {
  applied: { label: "Applied", emoji: "📨", group: "Career totals" },
  rejected: { label: "Rejected", emoji: "💀", group: "Career totals" },
  ghosted: { label: "Ghosted", emoji: "👻", group: "Career totals" },
  interviews: { label: "Interviews", emoji: "🎯", group: "Career totals" },
  offers: { label: "Offers", emoji: "🏆", group: "Career totals" },
  funnel: { label: "The funnel", emoji: "📉", group: "Sections" },
  fastestRejection: { label: "Fastest rejection", emoji: "⚡", group: "Time records" },
  avgDaysToRejection: { label: "Avg days to rejection", emoji: "🕰️", group: "Time records" },
  longestGhost: { label: "Longest ghost", emoji: "👻", group: "Time records" },
  badges: { label: "Badges", emoji: "🎖️", group: "Sections" },
  tombstones: { label: "The graveyard", emoji: "🪦", group: "Sections" },
};

/** Parse the comma-joined hidden-fields string, dropping anything unrecognized. */
export function parseHiddenProfileFields(
  raw: string | null | undefined,
): HideableProfileField[] {
  if (!raw) return [];
  const valid = new Set<string>(HIDEABLE_PROFILE_FIELDS);
  const out: HideableProfileField[] = [];
  for (const part of raw.split(",")) {
    const key = part.trim();
    if (valid.has(key)) out.push(key as HideableProfileField);
  }
  return out;
}

/** Output of the email classifier (rules layer or LLM layer). */
export interface ClassifiedEmail {
  event: "applied_confirmation" | "rejection" | "interview_invite" | "offer" | "other";
  company: string | null;
  role: string | null;
  confidence: Confidence;
  layer: "rules" | "llm";
}

export interface EmailInput {
  from: string; // full From header, e.g. 'Greenhouse <no-reply@us.greenhouse-mail.io>'
  subject: string;
  bodyText: string; // already stripped to plain text
  receivedAt: Date;
}

export interface SyncResult {
  scanned: number;
  classified: number;
  eventsCreated: number;
  applicationsCreated: number;
  skipped: number;
  errors: string[];
  /**
   * True when this run stopped at the per-run cap and more messages remain to
   * process. The client keeps calling /api/sync (showing running totals) until
   * a run returns hasMore=false, so a big first backfill never blocks in one
   * long request.
   */
  hasMore: boolean;
  /**
   * Progress for the sync UI. totalCandidates = how many candidate messages
   * this run listed (query hits or history feed); remaining = how many of
   * those were not reached before the run stopped (0 when the run completed).
   * Already-synced messages skip instantly, so progress leaps forward on
   * resumed runs instead of restarting from zero.
   */
  totalCandidates: number;
  remaining: number;
}

export interface Badge {
  id: string;
  name: string;
  emoji: string;
  description: string;
}

export interface ProfileStats {
  applied: number;
  rejected: number;
  ghosted: number;
  interviews: number;
  offers: number;
  pending: number;
  rejectionLevel: number; // floor(sqrt(rejected))
  levelTitle: string;
  ghostRate: number | null; // ghosted / applied, 0..1
  responseRate: number | null; // (rejected+interviews+offers) / applied
  avgDaysToRejection: number | null;
  fastestRejectionHours: number | null;
  longestGhostDays: number | null;
  currentStreakWeeks: number; // consecutive weeks with >=1 rejection
  badges: Badge[];
}

export interface ApplicationWithStatus {
  id: string;
  company: string;
  role: string | null;
  source: string;
  appliedAt: Date;
  status: ApplicationStatus;
  daysSinceApplied: number;
  lastEventAt: Date;
}

export interface LeaderboardEntry {
  rank: number;
  slug: string;
  displayName: string;
  value: number;
  isKing?: boolean;
}

export interface Leaderboards {
  weekStartUtc: Date;
  king: LeaderboardEntry | null; // most rejections this week
  weeklyRejected: LeaderboardEntry[];
  weeklyGhosted: LeaderboardEntry[];
  allTimeRejected: LeaderboardEntry[];
  speedrun: LeaderboardEntry[]; // fastest applied->rejected, value = hours (asc)
}
