// Leaderboards. Opt-in, public-profile users only (User.leaderboardOptIn +
// User.publicProfile — private profiles never appear anywhere), top 10 per board.
// "Week" = ISO week starting Monday 00:00 UTC (DESIGN.md §2).
// The weekly most-rejected user is crowned Unemployed King 👑.

import { db } from "@/lib/db";
import type { LeaderboardEntry, Leaderboards } from "@/lib/types";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Monday 00:00:00.000 UTC of the ISO week containing `d`. */
export function isoWeekStartUtc(d: Date): Date {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Sunday=0 → 6 days since Monday
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday)
  );
}

interface BoardUser {
  id: string;
  slug: string;
  displayName: string | null;
}

function buildBoard(
  values: Map<string, number>,
  usersById: Map<string, BoardUser>,
  direction: "asc" | "desc",
  round: (n: number) => number
): LeaderboardEntry[] {
  const rows: { slug: string; displayName: string; value: number }[] = [];
  for (const [userId, value] of values) {
    const user = usersById.get(userId);
    if (!user) continue;
    if (direction === "desc" && value <= 0) continue; // zero scores don't rank
    rows.push({
      slug: user.slug,
      displayName: user.displayName ?? user.slug,
      value,
    });
  }

  rows.sort((a, b) => {
    if (a.value !== b.value) {
      return direction === "asc" ? a.value - b.value : b.value - a.value;
    }
    return a.slug.localeCompare(b.slug); // deterministic tie-break
  });

  return rows.slice(0, 10).map((row, i) => ({
    rank: i + 1,
    slug: row.slug,
    displayName: row.displayName,
    value: round(row.value),
  }));
}

const identity = (n: number) => n;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute all leaderboards:
 * - weeklyRejected / weeklyGhosted: events with occurredAt in the current ISO
 *   week (Monday 00:00 UTC ≤ t < next Monday).
 * - allTimeRejected: total rejected events.
 * - speedrun: per user, the minimum (rejected.occurredAt − applied.occurredAt)
 *   in hours across same-application pairs, ascending (fastest first).
 * - king = weeklyRejected[0] (or null when nobody was rejected this week —
 *   the throne sits empty).
 */
export async function getLeaderboards(): Promise<Leaderboards> {
  const now = new Date();
  const weekStartUtc = isoWeekStartUtc(now);
  const weekStartMs = weekStartUtc.getTime();
  const weekEndMs = weekStartMs + WEEK_MS;

  const users = await db.user.findMany({
    where: { leaderboardOptIn: true, publicProfile: true },
    select: { id: true, slug: true, displayName: true },
  });

  if (users.length === 0) {
    return {
      weekStartUtc,
      king: null,
      weeklyRejected: [],
      weeklyGhosted: [],
      allTimeRejected: [],
      speedrun: [],
    };
  }

  const usersById = new Map<string, BoardUser>(users.map((u) => [u.id, u]));

  const events = await db.event.findMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      type: { in: ["applied", "rejected", "ghosted"] },
    },
    select: {
      userId: true,
      applicationId: true,
      type: true,
      occurredAt: true,
    },
  });

  const weeklyRejected = new Map<string, number>();
  const weeklyGhosted = new Map<string, number>();
  const allTimeRejected = new Map<string, number>();
  // Speedrun bookkeeping: earliest applied / rejected timestamps per application.
  const appliedAtByApp = new Map<string, number>();
  const rejectionByApp = new Map<string, { userId: string; earliestMs: number }>();

  const bump = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) ?? 0) + 1);

  for (const event of events) {
    const atMs = event.occurredAt.getTime();
    const inCurrentWeek = atMs >= weekStartMs && atMs < weekEndMs;

    if (event.type === "rejected") {
      bump(allTimeRejected, event.userId);
      if (inCurrentWeek) bump(weeklyRejected, event.userId);
      if (event.applicationId) {
        const existing = rejectionByApp.get(event.applicationId);
        if (!existing || atMs < existing.earliestMs) {
          rejectionByApp.set(event.applicationId, {
            userId: event.userId,
            earliestMs: atMs,
          });
        }
      }
    } else if (event.type === "ghosted") {
      if (inCurrentWeek) bump(weeklyGhosted, event.userId);
    } else if (event.type === "applied" && event.applicationId) {
      const existing = appliedAtByApp.get(event.applicationId);
      if (existing === undefined || atMs < existing) {
        appliedAtByApp.set(event.applicationId, atMs);
      }
    }
  }

  // Fastest applied→rejected per user (same-application pairs only), in hours.
  const bestHoursByUser = new Map<string, number>();
  for (const [applicationId, rejection] of rejectionByApp) {
    const appliedMs = appliedAtByApp.get(applicationId);
    if (appliedMs === undefined) continue; // no applied event → no valid pair
    const hours = (rejection.earliestMs - appliedMs) / HOUR_MS;
    if (hours < 0) continue; // malformed timeline; ignore
    const best = bestHoursByUser.get(rejection.userId);
    if (best === undefined || hours < best) {
      bestHoursByUser.set(rejection.userId, hours);
    }
  }

  const weeklyRejectedBoard = buildBoard(weeklyRejected, usersById, "desc", identity);
  if (weeklyRejectedBoard.length > 0) weeklyRejectedBoard[0].isKing = true;
  const king = weeklyRejectedBoard.length > 0 ? { ...weeklyRejectedBoard[0] } : null;

  return {
    weekStartUtc,
    king,
    weeklyRejected: weeklyRejectedBoard,
    weeklyGhosted: buildBoard(weeklyGhosted, usersById, "desc", identity),
    allTimeRejected: buildBoard(allTimeRejected, usersById, "desc", identity),
    speedrun: buildBoard(bestHoursByUser, usersById, "asc", round2),
  };
}
