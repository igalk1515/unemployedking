// POST /api/sync — pull fresh misery from Gmail.
// Backfill on first run, incremental (history.list) after that.

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { GmailApiError, GmailAuthError } from "@/lib/gmail/client";
import { runBackfill, runIncrementalSync } from "@/lib/gmail/sync";

const SYNC_COOLDOWN_MS = 60_000;

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
  }
}
