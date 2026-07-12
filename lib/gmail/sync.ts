// lib/gmail/sync.ts — backfill + incremental Gmail sync orchestration.
//
// Idempotency (Data rule 5): every message id is checked against
// Event.gmailMessageId before we even fetch the message body, so re-running
// any sync over the same mail is a cheap no-op.

import { db } from "@/lib/db";
import {
  ATS_DOMAINS,
  classifyEmailTraced,
  hasApplicationKeywords,
  isAtsDomain,
} from "@/lib/classifier";
import type { SyncResult } from "@/lib/types";
import {
  GmailAuthError,
  extractEmailInput,
  getAccessToken,
  getMessage,
  getProfile,
  listHistory,
  listMessageIds,
} from "@/lib/gmail/client";
import { linkAndPersist } from "@/lib/gmail/linker";

/** Default first-sync lookback; User.backfillWindowDays overrides per user. */
const DEFAULT_BACKFILL_WINDOW_DAYS = 365;
/** Absolute ceiling on the user-configurable lookback. Two years of grief is plenty. */
export const MAX_BACKFILL_WINDOW_DAYS = 730;

function clampWindowDays(days: number | null | undefined): number {
  if (!days || !Number.isFinite(days)) return DEFAULT_BACKFILL_WINDOW_DAYS;
  return Math.min(Math.max(Math.floor(days), 1), MAX_BACKFILL_WINDOW_DAYS);
}

/** The user's configured lookback window, clamped to [1, MAX_BACKFILL_WINDOW_DAYS]. */
async function userWindowDays(userId: string): Promise<number> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { backfillWindowDays: true },
  });
  return clampWindowDays(user?.backfillWindowDays);
}

/**
 * Per-run work cap: once this many messages have produced a persisted event
 * (or an error), the run stops and leaves the cursors untouched so the next run
 * picks up where this one left off (`SyncResult.hasMore` tells the client to
 * call again). Kept small so each /api/sync call returns in a few seconds and
 * the UI can stream progress instead of blocking on one long request.
 * Messages that persist nothing — already-synced, gated out, classified
 * other/null — do NOT count: they are re-scanned every run, and counting them
 * would livelock a backfill over an inbox full of non-job mail.
 */
const MAX_NEW_MESSAGES_PER_RUN = 50;
const MAX_ERRORS_RECORDED = 25;

const SUBJECT_PHRASES = [
  '"your application"',
  '"thank you for applying"',
  '"thanks for applying"',
  '"application update"',
  '"application received"',
  '"we received your application"',
  '"your candidacy"',
  '"interview invitation"',
  // Direct-recruiter pipelines: interview/offer mail that never rides an ATS
  // domain (company inbox, Google Calendar invites). High-precision phrases so
  // the classifier, not the query, does the real filtering.
  '"interview with"',
  '"upcoming interview"',
  '"interview confirmation"',
  '"offer to join"',
  '"offer of employment"',
];

/**
 * High-precision rejection wording searched in the full message (not just the
 * subject) — catches human-written rejections whose subject is a useless
 * "Update"/"Next steps". Kept template-specific so it pulls in almost zero
 * non-job mail.
 */
const REJECTION_BODY_PHRASES = [
  '"regret to inform"',
  '"move forward with other candidates"',
  '"not to move forward"',
  '"pursue other candidates"',
  '"your application was not selected"',
];

function buildQuery(days: number): string {
  const fromClause = `from:(${ATS_DOMAINS.join(" OR ")})`;
  const subjectClause = `subject:(${SUBJECT_PHRASES.join(" OR ")})`;
  const rejectionClause = `(${REJECTION_BODY_PHRASES.join(" OR ")})`;
  return `(${fromClause} OR ${subjectClause} OR ${rejectionClause}) newer_than:${days}d`;
}

/** The catch-up query (BACKFILL_WINDOW_DAYS back): ATS senders OR application-ish subjects. */
export const BACKFILL_QUERY: string = buildQuery(DEFAULT_BACKFILL_WINDOW_DAYS);

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function emptySyncResult(): SyncResult {
  return {
    scanned: 0,
    classified: 0,
    eventsCreated: 0,
    applicationsCreated: 0,
    skipped: 0,
    errors: [],
    hasMore: false,
    totalCandidates: 0,
    remaining: 0,
    rulesClassified: 0,
    llmClassified: 0,
    llmCalls: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmCostUsd: 0,
  };
}

function pushError(result: SyncResult, message: string): void {
  if (result.errors.length < MAX_ERRORS_RECORDED) {
    result.errors.push(message);
  } else if (result.errors.length === MAX_ERRORS_RECORDED) {
    result.errors.push("…additional errors truncated");
  }
}

/** Run-level notices ("paused", "will retry") must survive error truncation. */
function pushNotice(result: SyncResult, message: string): void {
  result.errors.push(message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One line per sync run in the journal (`journalctl -u unemployedking`), so the
 * rules/LLM split — and what the LLM cost — is auditable after the fact and not
 * only visible in the browser. `llm=calls→events` reads as "billed calls →
 * events they actually produced"; the gap is mail Gemini read and discarded.
 */
function logRun(kind: "backfill" | "incremental", userId: string, result: SyncResult): void {
  const tokens = result.llmInputTokens + result.llmOutputTokens;
  console.log(
    `[sync/${kind}] user ${userId}: scanned ${result.scanned}, ` +
      `events ${result.eventsCreated} (rules ${result.rulesClassified}, llm ${result.llmClassified}), ` +
      `llm=${result.llmCalls} calls→${result.llmClassified} events, ` +
      `${tokens} tokens (${result.llmInputTokens} in / ${result.llmOutputTokens} out), ` +
      `cost $${result.llmCostUsd.toFixed(6)}, ` +
      `apps ${result.applicationsCreated}, skipped ${result.skipped}` +
      (result.hasMore ? ", paused at cap (more to do)" : ""),
  );
}

type SyncAccount = {
  id: string;
  encryptedRefreshToken: string | null;
  historyId: string | null;
  lastSyncedAt: Date | null;
  backfillDone: boolean;
};

async function requireAccount(userId: string): Promise<SyncAccount> {
  const acct = await db.emailAccount.findFirst({
    where: { userId, encryptedRefreshToken: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      encryptedRefreshToken: true,
      historyId: true,
      lastSyncedAt: true,
      backfillDone: true,
    },
  });
  if (!acct) {
    throw new GmailAuthError("No connected Gmail account with a stored refresh token.");
  }
  return acct;
}

/** Holds the access token; on a 401 mid-run we refresh once and retry the call. */
interface GmailSession {
  token: string;
  refreshed: boolean;
  acct: { encryptedRefreshToken: string | null };
}

async function openSession(acct: { encryptedRefreshToken: string | null }): Promise<GmailSession> {
  return { token: await getAccessToken(acct), refreshed: false, acct };
}

async function withAuth<T>(s: GmailSession, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(s.token);
  } catch (err) {
    if (err instanceof GmailAuthError && !s.refreshed) {
      s.refreshed = true;
      s.token = await getAccessToken(s.acct);
      return fn(s.token);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Per-message pipeline
// ---------------------------------------------------------------------------

type MessageOutcome = "new" | "existing" | "skipped" | "error";

/**
 * scanned  = every message id we looked at
 * skipped  = already-synced + gated-out messages + classifier said other/null
 * classified = messages that produced an actionable job event
 *
 * `gate` (history path only): the history feed is the WHOLE inbox, so skip
 * anything that is neither from an ATS domain nor application-flavored in the
 * subject before classifying — the client-side mirror of BACKFILL_QUERY.
 */
async function processMessage(
  userId: string,
  s: GmailSession,
  messageId: string,
  result: SyncResult,
  gate: boolean,
): Promise<MessageOutcome> {
  result.scanned++;
  try {
    const existing = await db.event.findUnique({
      where: { gmailMessageId: messageId },
      select: { id: true },
    });
    if (existing) {
      result.skipped++;
      return "existing";
    }

    const msg = await withAuth(s, (token) => getMessage(token, messageId));
    const extracted = extractEmailInput(msg);

    if (
      gate &&
      !isAtsDomain(extracted.senderDomain) &&
      !hasApplicationKeywords(extracted.subject)
    ) {
      result.skipped++;
      return "skipped";
    }

    const { classification: cls, llmCalled, usage, costUsd } = await classifyEmailTraced({
      from: extracted.from,
      subject: extracted.subject,
      bodyText: extracted.bodyText,
      receivedAt: extracted.receivedAt,
    });
    // Billed whether or not it produced anything — bank the cost before the bail-out.
    if (llmCalled) {
      result.llmCalls++;
      result.llmInputTokens += usage.inputTokens;
      result.llmOutputTokens += usage.outputTokens;
      result.llmCostUsd += costUsd;
    }

    if (!cls || cls.event === "other") {
      result.skipped++;
      return "skipped";
    }

    result.classified++;
    if (cls.layer === "llm") result.llmClassified++;
    else result.rulesClassified++;
    const { createdApplication, createdEvent } = await linkAndPersist(userId, cls, {
      messageId: extracted.messageId,
      threadId: extracted.threadId,
      senderDomain: extracted.senderDomain,
      receivedAt: extracted.receivedAt,
    });
    if (createdApplication) result.applicationsCreated++;
    if (createdEvent) result.eventsCreated++;
    // A lost race on the unique gmailMessageId persists nothing — treat it
    // like an already-synced message so it doesn't burn cap budget.
    return createdEvent || createdApplication ? "new" : "existing";
  } catch (err) {
    // A GmailAuthError here means the token is dead even after one refresh —
    // the whole run is doomed, so propagate instead of logging per message.
    if (err instanceof GmailAuthError) throw err;
    pushError(result, `message ${messageId}: ${errorMessage(err)}`);
    return "error";
  }
}

interface BatchOutcome {
  completed: boolean;
  hadErrors: boolean;
}

/**
 * Process message ids in the given order, stopping at the per-run cap.
 * Only persisted events and errors count toward the cap (see the
 * MAX_NEW_MESSAGES_PER_RUN comment); errors are reported per message and
 * surfaced in `hadErrors` so callers can keep their cursors recoverable.
 * Fills in result.totalCandidates/remaining so the client can show progress.
 */
async function processMessages(
  userId: string,
  s: GmailSession,
  ids: string[],
  result: SyncResult,
  opts: { gate: boolean },
): Promise<BatchOutcome> {
  let counted = 0;
  let hadErrors = false;
  result.totalCandidates = ids.length;
  result.remaining = 0;

  for (let i = 0; i < ids.length; i++) {
    if (counted >= MAX_NEW_MESSAGES_PER_RUN) {
      // Hit the per-run cap: more messages remain. The caller sets
      // result.hasMore=true so the client keeps calling until a run completes.
      result.remaining = ids.length - i;
      return { completed: false, hadErrors };
    }
    const outcome = await processMessage(userId, s, ids[i], result, opts.gate);
    if (outcome === "error") hadErrors = true;
    if (outcome === "new" || outcome === "error") counted++;
  }

  return { completed: true, hadErrors };
}

/**
 * Collect EVERY id matching a query (ids only — cheap), newest first — the
 * order messages.list already returns. Fresh mail lands on the dashboard in
 * the first batch, so a user watching their first backfill sees their current
 * hunt immediately instead of year-old history.
 *
 * Rejections processed before their application exists land as orphan events;
 * when the (older) confirmation later creates the Application it adopts
 * orphans from its own Gmail thread (see linker.ts), which covers the common
 * ATS same-thread reply. Cross-thread rejections without a resident
 * application stay orphaned — they still count toward totals (DESIGN §4.4).
 */
async function collectQueryIds(s: GmailSession, q: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const page = await withAuth(s, (token) => listMessageIds(token, q, pageToken));
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return ids;
}

/** Run a Gmail search query, processing every hit oldest → newest. */
async function processQuery(
  userId: string,
  s: GmailSession,
  q: string,
  result: SyncResult,
): Promise<BatchOutcome> {
  const ids = await collectQueryIds(s, q);
  return processMessages(userId, s, ids, result, { gate: false });
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * First sync for an account: sweep the user's configured lookback window of
 * ATS-looking mail (default 1 year, hard max 2).
 * The history cursor is snapshotted BEFORE processing, so anything that
 * arrives mid-backfill is caught by the next incremental run (and duplicates
 * are no-ops anyway).
 */
export async function runBackfill(userId: string): Promise<SyncResult> {
  const result = emptySyncResult();
  const acct = await requireAccount(userId);
  const s = await openSession(acct);

  const profile = await withAuth(s, (token) => getProfile(token));
  const lookbackDays = await userWindowDays(userId);
  const { completed, hadErrors } = await processQuery(
    userId,
    s,
    buildQuery(lookbackDays),
    result,
  );

  // Paused at the per-run cap => the client should call again for the next batch.
  result.hasMore = !completed;

  if (hadErrors) {
    pushNotice(
      result,
      "Some messages failed mid-backfill. Run sync again to retry them (already-synced mail skips instantly).",
    );
  }

  await db.emailAccount.update({
    where: { id: acct.id },
    data: {
      historyId: profile.historyId,
      lastSyncedAt: new Date(),
      // Only flip the flag when the whole window was processed error-free; a
      // paused or partly-failed backfill reruns (cheaply, thanks to
      // idempotency) on the next sync.
      ...(completed && !hadErrors ? { backfillDone: true } : {}),
    },
  });

  logRun("backfill", userId, result);
  return result;
}

/**
 * Incremental sync via users.history.list from the stored cursor. On an
 * expired cursor (or a missing one) fall back to the backfill query with a
 * newer_than window sized by lastSyncedAt, then re-anchor the cursor.
 */
export async function runIncrementalSync(userId: string): Promise<SyncResult> {
  const result = emptySyncResult();
  const acct = await requireAccount(userId);
  const s = await openSession(acct);

  let nextHistoryId: string | null = null;
  let completed = true;
  let hadErrors = false;

  if (acct.historyId) {
    const history = await withAuth(s, (token) => listHistory(token, acct.historyId as string));
    if (!history.expired) {
      nextHistoryId = history.newHistoryId;
      // The history feed is every new inbox message — gate the obvious
      // non-candidates so we don't classify (and LLM-bill) the whole inbox.
      ({ completed, hadErrors } = await processMessages(userId, s, history.messageIds, result, {
        gate: true,
      }));
    } else {
      ({ nextHistoryId, completed, hadErrors } = await fallbackQuerySync(
        userId,
        s,
        acct.lastSyncedAt,
        result,
      ));
    }
  } else {
    ({ nextHistoryId, completed, hadErrors } = await fallbackQuerySync(
      userId,
      s,
      acct.lastSyncedAt,
      result,
    ));
  }

  // Paused at the per-run cap => the client should call again for the next batch.
  result.hasMore = !completed;

  if (hadErrors) {
    pushNotice(
      result,
      "Some messages failed to process. Cursors stay put so the next sync retries them.",
    );
  }

  if (completed && !hadErrors) {
    await db.emailAccount.update({
      where: { id: acct.id },
      data: {
        lastSyncedAt: new Date(),
        ...(nextHistoryId ? { historyId: nextHistoryId } : {}),
      },
    });
  }
  // A paused or partly-failed run leaves cursors untouched so the next run
  // re-lists the same window (already-processed messages skip instantly) —
  // failed messages are never silently dropped.

  logRun("incremental", userId, result);
  return result;
}

async function fallbackQuerySync(
  userId: string,
  s: GmailSession,
  lastSyncedAt: Date | null,
  result: SyncResult,
): Promise<{ nextHistoryId: string | null; completed: boolean; hadErrors: boolean }> {
  // Snapshot the cursor before processing so nothing slips between the query
  // sync and the next history-based sync.
  const profile = await withAuth(s, (token) => getProfile(token));
  const maxDays = await userWindowDays(userId);
  const { completed, hadErrors } = await processQuery(
    userId,
    s,
    buildQuery(windowDays(lastSyncedAt, maxDays)),
    result,
  );
  return { nextHistoryId: profile.historyId, completed, hadErrors };
}

/** Days since the last sync, +1 for clock-skew slack, clamped to [1, maxDays]. */
function windowDays(lastSyncedAt: Date | null, maxDays: number): number {
  if (!lastSyncedAt) return maxDays;
  const elapsedDays = Math.ceil((Date.now() - lastSyncedAt.getTime()) / 86_400_000) + 1;
  return Math.min(Math.max(elapsedDays, 1), maxDays);
}
