"use client";

// Owner-only card: shows friends waiting for an invite while the app is in
// Google "testing" mode. Copy the emails into the OAuth consent screen's
// test-user list, then clear so only genuinely new requests remain.

import { useState } from "react";
import { markRequestsAdded } from "@/app/dashboard/actions";

export function AccessRequestsCard({ emails }: { emails: string[] }) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-gold/40 bg-gold/5 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gold">
          🔔 Access requests
        </h2>
        <span className="rounded-full bg-gold px-2.5 py-0.5 text-xs font-bold tabular-nums text-bg">
          {emails.length} waiting
        </span>
      </div>

      {emails.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          Nobody in the queue. When a friend requests access from the login page,
          they show up here.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-muted">
            Paste these into{" "}
            <span className="text-ink-2">
              Google Cloud Console → OAuth consent screen → Test users → Add users
            </span>
            , then clear the list so only new ones remain.
          </p>
          <textarea
            readOnly
            value={emails.join("\n")}
            rows={Math.min(Math.max(emails.length, 2), 8)}
            className="mt-3 w-full resize-y rounded-lg border border-edge bg-bg px-3 py-2 font-mono text-xs text-ink"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyAll}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-gold/85"
            >
              {copied ? "Copied ✓" : "Copy all emails"}
            </button>
            <form action={markRequestsAdded}>
              <button
                type="submit"
                className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:border-gold/50 hover:text-ink"
              >
                I&apos;ve added these — clear the list
              </button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}
