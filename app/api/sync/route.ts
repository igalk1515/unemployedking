// POST /api/sync — pull fresh misery from Gmail.
// Backfill on first run, incremental (history.list) after that.
//
// Cost guardrails: every run re-classifies borderline mail that produced no
// event last time (Gemini bills per call), so sync spam is real money. Three
// layers keep it in check:
//   1. A per-user in-flight lock — two syncs can't run concurrently, so a
//      double-click or second tab can't double-bill the same messages.
//   2. A rolling per-user hourly budget on sync runs — generous enough for a
//      full backfill's batch loop, a wall for autoclicker enthusiasm.
//   3. The existing 60s cooldown once an account is fully caught up.
// The lock and budget live in module scope: fine for the single-process
// systemd deploy; a multi-instance deploy would need shared storage.

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { GmailApiError, GmailAuthError } from "@/lib/gmail/client";
import { runBackfill, runIncrementalSync } from "@/lib/gmail/sync";

const SYNC_COOLDOWN_MS = 60_000;
const HOUR_MS = 3_600_000;
/** Max sync runs per user per rolling hour. A full first backfill loops up to
 * 50 batches in one click; this leaves headroom for a retry or two on top. */
const MAX_RUNS_PER_HOUR = 100;

const inFlight = new Set<string>();
const runLog = new Map<string, number[]>();

/** Record a run attempt; false when the rolling hourly budget is exhausted. */
function takeRunBudget(userId: string): boolean {
  const now = Date.now();
  const recent = (runLog.get(userId) ?? []).filter((t) => now - t < HOUR_MS);
  if (recent.length >= MAX_RUNS_PER_HOUR) {
    runLog.set(userId, recent);
    return false;
  }
  recent.push(now);
  runLog.set(userId, recent);
  return true;
}

export async function POST(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json(
      { error: "You must be logged in to sync. The rejections won't fetch themselves." },
      { status: 401 },
    );
  }

  const account = await db.emailAccount.findFirst({
    where: { userId, encryptedRefreshToken: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { backfillDone: true, lastSyncedAt: true },
  });
  if (!account) {
    return Response.json(
      {
        error:
          "No Gmail account connected. Connect your inbox so we can count your Ls. Sign in with Google first.",
      },
      { status: 400 },
    );
  }

  if (inFlight.has(userId)) {
    return Response.json(
      { error: "A sync is already running. One shovel per grave, please." },
      { status: 429 },
    );
  }

  // Cooldown — but never in the way of a backfill in progress: a paused
  // backfill keeps backfillDone=false, and a capped/failed incremental run
  // doesn't advance lastSyncedAt, so quick "resume" clicks sail through.
  // Only a fully-caught-up sync arms the 60s timer.
  if (
    account.backfillDone &&
    account.lastSyncedAt &&
    Date.now() - account.lastSyncedAt.getTime() < SYNC_COOLDOWN_MS
  ) {
    return Response.json(
      { error: "Your rejections aren't going anywhere. Try again in a minute." },
      { status: 429 },
    );
  }

  if (!takeRunBudget(userId)) {
    return Response.json(
      {
        error:
          "That's enough syncing for one hour. Every click costs us actual money, and unlike you, we can't expense the grief. Come back later.",
      },
      { status: 429 },
    );
  }

  inFlight.add(userId);
  try {
    const result = account.backfillDone
      ? await runIncrementalSync(userId)
      : await runBackfill(userId);
    return Response.json(result);
  } catch (err) {
    // 403 = the token is valid but lacks Gmail read scope: they skipped the
    // "Read your email" checkbox on Google's consent screen. Point them at the fix.
    if (err instanceof GmailApiError && err.status === 403) {
      console.error("[api/sync] gmail scope missing (403):", err.message);
      return Response.json(
        {
          error:
            "You haven't granted Gmail read access. Reconnect with Google and tick the 'Read your email' box — we can't count what we can't see.",
          action: "reconnect",
        },
        { status: 400 },
      );
    }
    if (err instanceof GmailAuthError) {
      console.error("[api/sync] auth failure:", err.message);
      return Response.json(
        {
          error:
            "Google refused our advances (token expired or revoked). Reconnect Gmail and try again.",
          action: "reconnect",
        },
        { status: 400 },
      );
    }
    console.error("[api/sync] sync failed:", err);
    return Response.json(
      {
        error:
          "Sync fell over mid-run. Even our code gets rejected sometimes. Try again in a minute.",
      },
      { status: 500 },
    );
  } finally {
    inFlight.delete(userId);
  }
}
