// lib/ghost.ts — the ghost sweeper (Data rule 6).
//
// For every application whose derived status is still `applied` or
// `interview`, that has no `ghosted` event, and whose appliedAt is older than
// the user's ghostAfterDays window: append ONE `ghosted` event
// (source=system, occurredAt=now). Append-only; nothing is ever updated.

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
    const cutoff = new Date(now.getTime() - user.ghostAfterDays * MS_PER_DAY);

    const applications = await db.application.findMany({
      where: { userId: user.id, appliedAt: { lt: cutoff } },
      select: {
        id: true,
        events: { select: { type: true, occurredAt: true } },
      },
    });

    const toGhost = applications.filter((app) => {
      if (app.events.some((e) => e.type === "ghosted")) return false;
      const status = deriveStatus(app.events);
      return status === "applied" || status === "interview";
    });

    if (toGhost.length === 0) continue;

    const created = await db.event.createMany({
      data: toGhost.map((app) => ({
        userId: user.id,
        applicationId: app.id,
        type: "ghosted",
        source: "system",
        confidence: "high",
        occurredAt: now,
      })),
    });
    ghostsCreated += created.count;
  }

  return { usersProcessed: users.length, ghostsCreated };
}
