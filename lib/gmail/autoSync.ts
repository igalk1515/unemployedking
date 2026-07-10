// lib/gmail/autoSync.ts — scheduled recurring sync.
//
// For every user who opted into an auto-sync cadence (User.autoSyncIntervalDays),
// run their Gmail sync once the interval has elapsed since their last sync.
// Triggered by GET /api/cron/auto-sync (CRON_SECRET-guarded). Schedule that
// endpoint to run at least as often as the shortest cadence you allow (daily).

import { db } from "@/lib/db";
import { GmailAuthError } from "@/lib/gmail/client";
import { runBackfill, runIncrementalSync } from "@/lib/gmail/sync";

/** Ceiling on the user-configurable cadence. Rarer than quarterly is just "manual". */
export const MAX_AUTO_SYNC_INTERVAL_DAYS = 90;

const DAY_MS = 86_400_000;
/** Fire slightly early so a cron running a hair under the interval still catches it. */
const DUE_GRACE_MS = 60 * 60 * 1000; // 1 hour
/** Per-invocation ceiling so one sweep can't run forever; the overflow waits for the next tick. */
const MAX_ACCOUNTS_PER_RUN = 50;

export interface AutoSyncReport {
  eligible: number; // accounts whose owner has a cadence set + a live token
  due: number; // of those, how many were due this run
  synced: number; // successfully synced
  eventsCreated: number; // aggregate new events across all synced accounts
  deferred: number; // due accounts left for the next tick (per-run cap hit)
  errors: string[];
}

/** Has enough time passed since the last sync (never-synced is always due)? */
function isDue(lastSyncedAt: Date | null, intervalDays: number, now: number): boolean {
  if (!lastSyncedAt) return true;
  return now - lastSyncedAt.getTime() >= intervalDays * DAY_MS - DUE_GRACE_MS;
}

export async function runDueSyncs(): Promise<AutoSyncReport> {
  const report: AutoSyncReport = {
    eligible: 0,
    due: 0,
    synced: 0,
    eventsCreated: 0,
    deferred: 0,
    errors: [],
  };
  const now = Date.now();

  // Everyone who opted into a cadence and still has a live token. We sync the
  // primary inbox — the oldest connected account — mirroring the sync entry
  // points in sync.ts (requireAccount).
  const users = await db.user.findMany({
    where: {
      autoSyncIntervalDays: { not: null },
      emailAccounts: { some: { encryptedRefreshToken: { not: null } } },
    },
    select: {
      id: true,
      autoSyncIntervalDays: true,
      emailAccounts: {
        where: { encryptedRefreshToken: { not: null } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { lastSyncedAt: true, backfillDone: true },
      },
    },
  });

  const dueUsers: { id: string; backfillDone: boolean; lastSyncedAt: Date | null }[] = [];
  for (const user of users) {
    const acct = user.emailAccounts[0];
    const interval = user.autoSyncIntervalDays;
    // The token could have been revoked between the two filter clauses, and a
    // null cadence is filtered out at the DB — both guards are belt-and-braces.
    if (!acct || interval == null) continue;
    report.eligible++;
    if (isDue(acct.lastSyncedAt, interval, now)) {
      dueUsers.push({ id: user.id, backfillDone: acct.backfillDone, lastSyncedAt: acct.lastSyncedAt });
    }
  }

  // Most-overdue first (never-synced sorts to the front) so a capped run makes
  // the fairest progress.
  dueUsers.sort((a, b) => (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0));
  report.due = dueUsers.length;

  const batch = dueUsers.slice(0, MAX_ACCOUNTS_PER_RUN);
  report.deferred = dueUsers.length - batch.length;

  // This runs unattended on a schedule, so every invocation leaves a trail:
  // one line for the sweep, one per synced account, and a closing summary.
  console.log(
    `[auto-sync] sweep: ${report.eligible} eligible, ${report.due} due, running ${batch.length}` +
      (report.deferred > 0 ? `, ${report.deferred} deferred to next tick` : ""),
  );

  for (const u of batch) {
    try {
      const result = u.backfillDone
        ? await runIncrementalSync(u.id)
        : await runBackfill(u.id);
      report.synced++;
      report.eventsCreated += result.eventsCreated;
      console.log(
        `[auto-sync] user ${u.id} synced (${u.backfillDone ? "incremental" : "backfill"}): ` +
          `${result.eventsCreated} new event(s), ${result.errors.length} notice(s)`,
      );
    } catch (err) {
      // One dead token must not sink the whole sweep — record and move on.
      const message =
        err instanceof GmailAuthError
          ? "auth expired (needs a Gmail reconnect)"
          : err instanceof Error
            ? err.message
            : String(err);
      report.errors.push(`user ${u.id}: ${message}`);
      console.error(`[auto-sync] user ${u.id} failed: ${message}`);
    }
  }

  console.log(
    `[auto-sync] done: synced ${report.synced}/${batch.length}, ` +
      `${report.eventsCreated} new event(s), ${report.errors.length} error(s)`,
  );

  return report;
}
