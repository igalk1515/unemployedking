// Profile stats: everything a public profile page or dashboard needs about a
// user's glorious losing streak. Status is always derived (Data rule 2);
// orphan events (applicationId null) still count toward totals per DESIGN §4.4.

import { db } from "@/lib/db";
import type {
  ApplicationWithStatus,
  EventType,
  HideableProfileField,
  ProfileStats,
} from "@/lib/types";
import { parseHiddenProfileFields } from "@/lib/types";
import { computeBadges } from "./badges";
import { isoWeekStartUtc } from "./leaderboard";
import { rejectionLevel } from "./levels";
import { deriveStatus } from "./status";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface SlimEvent {
  applicationId: string | null;
  type: string;
  occurredAt: Date;
}

/** Current streak: consecutive ISO weeks with ≥1 rejection, counting back from
 * the current week. If the current (unfinished) week has no rejection yet, the
 * streak is not broken — counting starts from last week instead. */
function rejectionStreaks(rejectionEventTimes: Date[], now: Date): {
  current: number;
  longest: number;
} {
  const weekKeys = new Set<number>();
  for (const at of rejectionEventTimes) {
    weekKeys.add(isoWeekStartUtc(at).getTime());
  }
  if (weekKeys.size === 0) return { current: 0, longest: 0 };

  const currentWeekMs = isoWeekStartUtc(now).getTime();
  let cursor = weekKeys.has(currentWeekMs) ? currentWeekMs : currentWeekMs - WEEK_MS;
  let current = 0;
  while (weekKeys.has(cursor)) {
    current++;
    cursor -= WEEK_MS;
  }

  let longest = 0;
  for (const week of weekKeys) {
    if (weekKeys.has(week - WEEK_MS)) continue; // not the start of a run
    let length = 1;
    while (weekKeys.has(week + length * WEEK_MS)) length++;
    if (length > longest) longest = length;
  }

  return { current, longest };
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const [applications, events] = await Promise.all([
    db.application.findMany({
      where: { userId },
      select: { id: true, appliedAt: true },
    }),
    db.event.findMany({
      where: { userId },
      select: { applicationId: true, type: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
  ]);

  const countByType: Record<EventType, number> = {
    applied: 0,
    rejected: 0,
    ghosted: 0,
    interview: 0,
    offer: 0,
  };
  const eventsByApp = new Map<string, SlimEvent[]>();
  const rejectionTimes: Date[] = [];

  for (const event of events) {
    if (event.type in countByType) countByType[event.type as EventType]++;
    if (event.type === "rejected") rejectionTimes.push(event.occurredAt);
    if (event.applicationId) {
      const list = eventsByApp.get(event.applicationId);
      if (list) list.push(event);
      else eventsByApp.set(event.applicationId, [event]);
    }
  }

  const now = new Date();
  const nowMs = now.getTime();

  let pending = 0;
  let necromancerCases = 0;
  let fastestRejectionHours: number | null = null;
  let longestGhostMs: number | null = null;
  const daysToRejection: number[] = [];

  for (const app of applications) {
    // Per-app events are already sorted ascending (query orderBy).
    const appEvents = eventsByApp.get(app.id) ?? [];
    const status = deriveStatus(appEvents);
    if (status === "applied" || status === "interview") pending++;

    const appliedEvent = appEvents.find((e) => e.type === "applied");
    const appliedMs = Math.min(
      app.appliedAt.getTime(),
      appliedEvent ? appliedEvent.occurredAt.getTime() : Number.POSITIVE_INFINITY
    );

    const firstRejection = appEvents.find(
      (e) => e.type === "rejected" && e.occurredAt.getTime() >= appliedMs
    );
    if (firstRejection) {
      const waitedMs = firstRejection.occurredAt.getTime() - appliedMs;
      daysToRejection.push(waitedMs / DAY_MS);
      const hours = waitedMs / HOUR_MS;
      if (fastestRejectionHours === null || hours < fastestRejectionHours) {
        fastestRejectionHours = hours;
      }
    }

    for (let i = 0; i < appEvents.length; i++) {
      const event = appEvents[i];
      if (event.type !== "ghosted") continue;
      const ghostMs = event.occurredAt.getTime();

      if (
        appEvents.some(
          (e) => e.type === "rejected" && e.occurredAt.getTime() > ghostMs
        )
      ) {
        necromancerCases++;
      }

      // Ghost duration: silence from the last event before the ghost marker
      // (or the application itself) until revival — or until now, if the
      // haunting continues.
      const silenceStartMs = i > 0 ? appEvents[i - 1].occurredAt.getTime() : appliedMs;
      const revival = appEvents
        .slice(i + 1)
        .find((e) => e.type !== "ghosted" && e.occurredAt.getTime() > ghostMs);
      const silenceEndMs = revival ? revival.occurredAt.getTime() : nowMs;
      const duration = silenceEndMs - silenceStartMs;
      if (duration > 0 && (longestGhostMs === null || duration > longestGhostMs)) {
        longestGhostMs = duration;
      }
    }
  }

  const applied = applications.length;
  const { level, title } = rejectionLevel(countByType.rejected);
  const streaks = rejectionStreaks(rejectionTimes, now);

  const badges = computeBadges({
    applications: applied,
    rejections: countByType.rejected,
    ghosted: countByType.ghosted,
    interviews: countByType.interview,
    offers: countByType.offer,
    fastestRejectionHours,
    necromancerCases,
    longestRejectionStreakWeeks: streaks.longest,
  });

  return {
    applied,
    rejected: countByType.rejected,
    ghosted: countByType.ghosted,
    interviews: countByType.interview,
    offers: countByType.offer,
    pending,
    rejectionLevel: level,
    levelTitle: title,
    ghostRate: applied > 0 ? Math.min(1, countByType.ghosted / applied) : null,
    responseRate:
      applied > 0
        ? Math.min(
            1,
            (countByType.rejected + countByType.interview + countByType.offer) /
              applied
          )
        : null,
    avgDaysToRejection:
      daysToRejection.length > 0
        ? round1(
            daysToRejection.reduce((sum, d) => sum + d, 0) / daysToRejection.length
          )
        : null,
    fastestRejectionHours:
      fastestRejectionHours !== null ? round2(fastestRejectionHours) : null,
    longestGhostDays: longestGhostMs !== null ? Math.round(longestGhostMs / DAY_MS) : null,
    currentStreakWeeks: streaks.current,
    badges,
  };
}

/**
 * All of a user's applications with derived status, sorted by most recent
 * activity first (lastEventAt desc) — the tombstone list falls out naturally.
 */
export async function getApplicationsWithStatus(
  userId: string
): Promise<ApplicationWithStatus[]> {
  const applications = await db.application.findMany({
    where: { userId },
    select: {
      id: true,
      company: true,
      role: true,
      source: true,
      appliedAt: true,
      events: {
        select: { type: true, occurredAt: true },
        orderBy: { occurredAt: "asc" },
      },
    },
  });

  const nowMs = Date.now();

  return applications
    .map((app) => {
      const lastEvent = app.events[app.events.length - 1];
      return {
        id: app.id,
        company: app.company,
        role: app.role,
        source: app.source,
        appliedAt: app.appliedAt,
        status: deriveStatus(app.events),
        daysSinceApplied: Math.max(
          0,
          Math.floor((nowMs - app.appliedAt.getTime()) / DAY_MS)
        ),
        lastEventAt: lastEvent ? lastEvent.occurredAt : app.appliedAt,
      };
    })
    .sort((a, b) => b.lastEventAt.getTime() - a.lastEventAt.getTime());
}

/**
 * Public-page identity lookup. Private profiles (publicProfile=false) are
 * treated as not found — nobody needs to know you gave up.
 */
export async function getUserBySlug(slug: string): Promise<{
  id: string;
  slug: string;
  displayName: string;
  createdAt: Date;
  hiddenFields: HideableProfileField[];
} | null> {
  const user = await db.user.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      displayName: true,
      publicProfile: true,
      hiddenProfileFields: true,
      createdAt: true,
    },
  });

  if (!user || !user.publicProfile) return null;

  return {
    id: user.id,
    slug: user.slug,
    displayName: user.displayName ?? user.slug,
    createdAt: user.createdAt,
    hiddenFields: parseHiddenProfileFields(user.hiddenProfileFields),
  };
}
