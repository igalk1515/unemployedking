// lib/ghost.ts — the ghost sweeper (Data rule 6).
//
// For every application whose derived status is still `applied` or
// `interview`, that has no `ghosted` event, and whose LAST ACTIVITY (latest
// event, falling back to appliedAt) is older than the user's ghostAfterDays
// window: append ONE `ghosted` event (source=system). Append-only; nothing is
// ever updated.
//
// Silence is measured from the last activity, not from appliedAt — an
// application with an interview invite from last week is alive no matter how
// old the application itself is.
//
// The ghost event is backdated to lastActivity + ghostAfterDays (the moment
// the silence became a ghosting), not stamped `now`. Sweeping a freshly
// backfilled year of history would otherwise dump hundreds of `ghosted`
// events dated today, flooding the weekly ghosted leaderboard and hoisting
// year-old tombstones to the top of the dashboard.

import { db } from "@/lib/db";
import { deriveStatus } from "@/lib/stats/status";

const MS_PER_DAY = 86_400_000;

export async function runGhostSweep(): Promise<{
  usersProcessed: number;
  ghostsCreated: number;
}> {
  const now = new Date();
  const users = await db.user.findMany({ select: { id: true, ghostAfterDays: true } });

  let ghostsCreated = 0;

  for (const user of users) {
    const windowMs = user.ghostAfterDays * MS_PER_DAY;
    const cutoff = new Date(now.getTime() - windowMs);

    // appliedAt < cutoff is a cheap necessary condition (last activity can
    // never precede the application itself); the real silence check follows.
    const applications = await db.application.findMany({
      where: { userId: user.id, appliedAt: { lt: cutoff } },
      select: {
        id: true,
        appliedAt: true,
        events: { select: { type: true, occurredAt: true } },
      },
    });

    const toGhost: { id: string; ghostedAt: Date }[] = [];
    for (const app of applications) {
      if (app.events.some((e) => e.type === "ghosted")) continue;
      const status = deriveStatus(app.events);
      if (status !== "applied" && status !== "interview") continue;

      const lastActivityMs = app.events.reduce(
        (max, e) => Math.max(max, e.occurredAt.getTime()),
        app.appliedAt.getTime(),
      );
      if (lastActivityMs >= cutoff.getTime()) continue; // responded recently — still alive

      toGhost.push({ id: app.id, ghostedAt: new Date(lastActivityMs + windowMs) });
    }

    if (toGhost.length === 0) continue;

    const created = await db.event.createMany({
      data: toGhost.map((app) => ({
        userId: user.id,
        applicationId: app.id,
        type: "ghosted",
        source: "system",
        confidence: "high",
        occurredAt: app.ghostedAt,
      })),
    });
    ghostsCreated += created.count;
  }

  return { usersProcessed: users.length, ghostsCreated };
}
