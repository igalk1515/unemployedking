"use client";

// "Sync now" — drives /api/sync in small batches. Each call processes a capped
// chunk and returns `hasMore` plus progress totals; we keep calling until
// hasMore is false, painting a progress bar as rejections land, and refresh
// the server components after each batch so the tables fill in progressively.
// No single long request => no 504, no spinner-of-death on a big first backfill.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SyncResult } from "@/lib/types";

/** Client-side safety bound on the batch loop (50 msgs/batch => 2500 events). */
const MAX_BATCHES = 50;

interface Totals {
  batches: number;
  classified: number;
  eventsCreated: number;
  applicationsCreated: number;
  /** Found by the free, deterministic rules layer. */
  rulesClassified: number;
  /** Found by Gemini (billed). */
  llmClassified: number;
  /** Gemini calls made — billed whether or not they yielded an event. */
  llmCalls: number;
  /** What those calls actually cost, from Gemini's own token counts. USD. */
  llmCostUsd: number;
  errors: string[];
}

interface Progress {
  /** 0..1 of the current run's candidate list, null before the first batch lands. */
  fraction: number | null;
  processed: number;
  total: number;
}

type SyncState =
  | { phase: "idle" }
  | { phase: "syncing"; totals: Totals; progress: Progress }
  | { phase: "done"; totals: Totals }
  | { phase: "error"; message: string; totals: Totals | null; reconnect?: boolean };

function emptyTotals(): Totals {
  return {
    batches: 0,
    classified: 0,
    eventsCreated: 0,
    applicationsCreated: 0,
    rulesClassified: 0,
    llmClassified: 0,
    llmCalls: 0,
    llmCostUsd: 0,
    errors: [],
  };
}

function extractError(body: unknown, status: number): string {
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return `Sync failed with status ${status}. No explanation given. Very on-brand.`;
}

function extractAction(body: unknown): string | null {
  if (
    body !== null &&
    typeof body === "object" &&
    "action" in body &&
    typeof (body as { action: unknown }).action === "string"
  ) {
    return (body as { action: string }).action;
  }
  return null;
}

function isSyncResult(body: unknown): body is SyncResult {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof (body as SyncResult).scanned === "number" &&
    typeof (body as SyncResult).hasMore === "boolean" &&
    Array.isArray((body as SyncResult).errors)
  );
}

/** Sub-cent sums are the norm here, so don't round them to a meaningless "$0.00". */
function formatUsd(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}

function progressFrom(result: SyncResult): Progress {
  const total = typeof result.totalCandidates === "number" ? result.totalCandidates : 0;
  const remaining = typeof result.remaining === "number" ? result.remaining : 0;
  if (total <= 0) return { fraction: null, processed: 0, total: 0 };
  const processed = Math.max(0, total - remaining);
  return { fraction: Math.min(1, processed / total), processed, total };
}

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>({ phase: "idle" });
  const syncing = state.phase === "syncing";

  async function handleSync() {
    if (syncing) return;
    const totals = emptyTotals();
    setState({
      phase: "syncing",
      totals: { ...totals },
      progress: { fraction: null, processed: 0, total: 0 },
    });

    try {
      for (let i = 0; i < MAX_BATCHES; i++) {
        const res = await fetch("/api/sync", { method: "POST" });
        const body: unknown = await res.json().catch(() => null);

        if (res.status === 429) {
          // Cooldown / budget armed. If we already imported something, we're done.
          if (totals.batches > 0) break;
          setState({ phase: "error", message: extractError(body, res.status), totals: null });
          return;
        }
        if (!res.ok) {
          setState({
            phase: "error",
            message: extractError(body, res.status),
            totals: totals.batches > 0 ? { ...totals } : null,
            reconnect: extractAction(body) === "reconnect",
          });
          return;
        }
        if (!isSyncResult(body)) {
          setState({
            phase: "error",
            message: "The sync endpoint replied in tongues. Try again.",
            totals: totals.batches > 0 ? { ...totals } : null,
          });
          return;
        }

        totals.batches += 1;
        totals.classified += body.classified;
        totals.eventsCreated += body.eventsCreated;
        totals.applicationsCreated += body.applicationsCreated;
        totals.rulesClassified += body.rulesClassified ?? 0;
        totals.llmClassified += body.llmClassified ?? 0;
        totals.llmCalls += body.llmCalls ?? 0;
        totals.llmCostUsd += body.llmCostUsd ?? 0;
        for (const e of body.errors) if (!totals.errors.includes(e)) totals.errors.push(e);

        setState({ phase: "syncing", totals: { ...totals }, progress: progressFrom(body) });
        router.refresh(); // stream fresh rows into the tables as each batch lands

        if (!body.hasMore) break;
      }

      setState({ phase: "done", totals: { ...totals } });
      router.refresh();
    } catch {
      setState({
        phase: "error",
        message: "Network error. Even our own API ghosted us. Try again.",
        totals: totals.batches > 0 ? { ...totals } : null,
      });
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className="w-full rounded-lg bg-gold px-5 py-2.5 text-base font-semibold text-bg transition-colors hover:bg-gold/85 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
      >
        {syncing ? "Digging…" : "Sync now"}
      </button>

      <div aria-live="polite">
        {state.phase === "syncing" ? (
          <SyncProgress totals={state.totals} progress={state.progress} />
        ) : null}

        {state.phase === "done" ? <SyncSummary totals={state.totals} /> : null}

        {state.phase === "error" ? (
          <div className="mt-3">
            <p className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-red">
              <span aria-hidden="true">💀</span> {state.message}
            </p>
            {state.reconnect ? (
              <a
                href="/login"
                className="mt-2 inline-block rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-gold/85"
              >
                Reconnect Gmail
              </a>
            ) : null}
            {state.totals ? (
              <p className="mt-1 text-xs text-ink-muted">
                Imported {state.totals.eventsCreated} event
                {state.totals.eventsCreated === 1 ? "" : "s"} before it stopped. Hit Sync again to
                pick up where it left off — already-synced mail skips instantly.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SyncProgress({ totals, progress }: { totals: Totals; progress: Progress }) {
  const pct = progress.fraction !== null ? Math.round(progress.fraction * 100) : null;

  return (
    <div className="mt-3 rounded-lg border border-edge bg-bg px-3 py-2.5 text-xs text-ink-2">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-ink">
          <span aria-hidden="true">⛏️</span>{" "}
          {totals.eventsCreated > 0
            ? `Counting the bodies… ${totals.eventsCreated} found`
            : "Digging through your inbox…"}
        </p>
        {pct !== null ? <p className="tabular-nums text-ink">{pct}%</p> : null}
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-label="Sync progress"
        className="mt-2 h-2 overflow-hidden rounded-full bg-edge/60"
      >
        <div
          className={`h-full rounded-full bg-gold transition-[width] duration-500 ${
            pct === null ? "w-1/5 animate-pulse" : ""
          }`}
          style={pct !== null ? { width: `${Math.max(pct, 3)}%` } : undefined}
        />
      </div>

      <p className="mt-2 tabular-nums text-ink-muted">
        {progress.total > 0
          ? `${progress.processed.toLocaleString()} of ${progress.total.toLocaleString()} candidate emails · `
          : null}
        {totals.eventsCreated} events · {totals.applicationsCreated} applications ·{" "}
        {totals.batches} batch{totals.batches === 1 ? "" : "es"}
      </p>
      <p className="mt-1 text-ink-muted">
        Newest mail lands first. You can keep using the dashboard while this runs.
      </p>
    </div>
  );
}

function SyncSummary({ totals }: { totals: Totals }) {
  const headline =
    totals.eventsCreated > 0
      ? `Fresh misery imported: ${totals.eventsCreated} new event${
          totals.eventsCreated === 1 ? "" : "s"
        }.`
      : "Inbox scanned. No new pain found. Suspicious.";

  return (
    <div className="mt-3 rounded-lg border border-edge bg-bg px-3 py-2.5 text-xs text-ink-2">
      <p className="font-medium text-ink">{headline}</p>
      <p className="mt-1 tabular-nums text-ink-muted">
        classified {totals.classified} · new events {totals.eventsCreated} · applications{" "}
        {totals.applicationsCreated} · {totals.batches} batch{totals.batches === 1 ? "" : "es"}
      </p>
      <p className="mt-1 tabular-nums text-ink-muted">
        <span aria-hidden="true">📐</span> rules {totals.rulesClassified} ·{" "}
        <span aria-hidden="true">🤖</span> AI {totals.llmClassified}
        {totals.llmCalls > 0 ? (
          <>
            {" "}
            (from {totals.llmCalls} AI read{totals.llmCalls === 1 ? "" : "s"}, cost{" "}
            {formatUsd(totals.llmCostUsd)})
          </>
        ) : null}
      </p>
      {totals.errors.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-ink-muted">
            {totals.errors.length} grievance
            {totals.errors.length === 1 ? "" : "s"} filed during sync
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
            {totals.errors.slice(0, 5).map((error, i) => (
              <li key={i} className="break-words">
                {error}
              </li>
            ))}
            {totals.errors.length > 5 ? <li>…and {totals.errors.length - 5} more.</li> : null}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
