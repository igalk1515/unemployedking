// /u/[slug] — the public mastery page for losing. League-of-Legends energy,
// but the champion is you and the game is the job market.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getApplicationsWithStatus,
  getProfileStats,
  getUserBySlug,
} from "@/lib/stats/profile";
import { getLeaderboards } from "@/lib/stats/leaderboard";
import { funnyTagline } from "@/lib/stats/copy";
import type { ApplicationWithStatus, HideableProfileField } from "@/lib/types";
import { BadgeChip } from "@/components/BadgeChip";
import { CopyUrlButton } from "@/components/CopyUrlButton";
import { FunnelBar } from "@/components/FunnelBar";
import { StatTile } from "@/components/StatTile";
import { TombstoneRow } from "@/components/TombstoneRow";
import { formatHours, monthYearUTC } from "@/components/format";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Route params arrive percent-encoded; slugs are plain ascii, but decode
 * defensively so a mangled URL degrades to "not found" instead of a 500. */
function normalizeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const user = await getUserBySlug(normalizeSlug(slug));
  if (!user) {
    return {
      title: "Royal not found",
      description: "This profile does not exist, is private, or got a job.",
    };
  }
  const stats = await getProfileStats(user.id);
  const hidden = new Set<HideableProfileField>(user.hiddenFields);
  // Don't leak hidden stats through the share-preview description.
  const parts: string[] = [];
  if (!hidden.has("rejected")) parts.push(`${stats.rejected} rejections`);
  if (!hidden.has("ghosted")) parts.push(`${stats.ghosted} ghostings`);
  if (!hidden.has("applied")) parts.push(`${stats.applied} applications`);
  const description = `${parts.length ? `${parts.join(", ")}. ` : ""}Get rejected. Get ranked.`;
  return {
    title: `${user.displayName} · Lv.${stats.rejectionLevel} ${stats.levelTitle}`,
    description,
  };
}

/** Terminal = the application is over (one way or another). */
function isTerminal(app: ApplicationWithStatus): boolean {
  return app.status !== "applied" && app.status !== "interview";
}

/** Days from application to its final event — how long the hope lasted. */
function daysToTerminal(app: ApplicationWithStatus): number {
  return Math.max(
    0,
    Math.round((app.lastEventAt.getTime() - app.appliedAt.getTime()) / DAY_MS)
  );
}

export default async function ProfilePage({ params }: PageProps) {
  const { slug: rawSlug } = await params;
  const slug = normalizeSlug(rawSlug);

  const user = await getUserBySlug(slug);
  if (!user) notFound(); // renders ./not-found.tsx with a real 404 status

  const [stats, applications, boards] = await Promise.all([
    getProfileStats(user.id),
    getApplicationsWithStatus(user.id),
    getLeaderboards(),
  ]);

  const isKing = boards.king?.slug === user.slug;
  const tombstones = applications.filter(isTerminal).slice(0, 8);

  // Field visibility: the user can hide individual stats/sections from their
  // public profile (the dashboard privacy panel writes these). show() gates
  // each surface below; a fully hidden section drops out entirely.
  const hidden = new Set<HideableProfileField>(user.hiddenFields);
  const show = (field: HideableProfileField) => !hidden.has(field);
  const anyKpi =
    show("applied") ||
    show("rejected") ||
    show("ghosted") ||
    show("interviews") ||
    show("offers");
  const anyTimeStat =
    show("fastestRejection") ||
    show("avgDaysToRejection") ||
    show("longestGhost");

  const heardBack = stats.rejected + stats.interviews + stats.offers;
  const funnelMax = Math.max(
    stats.applied,
    heardBack,
    stats.interviews,
    stats.offers,
    1
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {isKing ? (
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-gold bg-gold/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gold">
              <span role="img" aria-label="crown">
                👑
              </span>
              Reigning Unemployed King
            </p>
          ) : null}
          <h1 className="truncate text-4xl font-extrabold tracking-tight sm:text-5xl">
            {user.displayName}
          </h1>
          <p className="mt-2 text-base font-semibold text-gold">
            Lv.{stats.rejectionLevel}{" "}
            <span className="text-ink-2">{stats.levelTitle}</span>
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Professionally losing since {monthYearUTC(user.createdAt)}.
          </p>
        </div>
        <div className="shrink-0">
          <CopyUrlButton path={`/u/${user.slug}`} label="Share this misery" />
        </div>
      </header>

      {/* KPI row */}
      {anyKpi ? (
        <section aria-label="Career totals" className="mt-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {show("applied") ? (
              <StatTile emoji="📨" label="Applied" value={stats.applied} accent="text-ink-2" />
            ) : null}
            {show("rejected") ? (
              <StatTile emoji="💀" label="Rejected" value={stats.rejected} accent="text-red" />
            ) : null}
            {show("ghosted") ? (
              <StatTile emoji="👻" label="Ghosted" value={stats.ghosted} accent="text-violet" />
            ) : null}
            {show("interviews") ? (
              <StatTile emoji="🎯" label="Interviews" value={stats.interviews} accent="text-blue" />
            ) : null}
            {show("offers") ? (
              <StatTile emoji="🏆" label="Offers" value={stats.offers} accent="text-good" />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Funnel */}
      {show("funnel") ? (
      <section className="mt-6 rounded-xl border border-edge bg-surface p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
          The funnel <span className="text-ink-muted">(more of a slide)</span>
        </h2>
        {stats.applied === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            No applications yet, so the funnel is purely theoretical. Like the
            job openings.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-[2px]">
            <FunnelBar emoji="📨" label="Applied" value={stats.applied} max={funnelMax} step={1} />
            <FunnelBar emoji="📬" label="Heard back" value={heardBack} max={funnelMax} step={2} />
            <FunnelBar emoji="🎯" label="Interview" value={stats.interviews} max={funnelMax} step={3} />
            <FunnelBar emoji="🏆" label="Offer" value={stats.offers} max={funnelMax} step={4} />
          </div>
        )}
      </section>
      ) : null}

      {/* Time stats */}
      {anyTimeStat ? (
        <section aria-label="Speed and silence records" className="mt-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {show("fastestRejection") ? (
              <StatTile
                emoji="⚡"
                label="Fastest rejection"
                value={
                  stats.fastestRejectionHours !== null
                    ? formatHours(stats.fastestRejectionHours)
                    : "N/A"
                }
                sub={
                  stats.fastestRejectionHours !== null
                    ? "personal best, frame it"
                    : "no timed runs yet"
                }
              />
            ) : null}
            {show("avgDaysToRejection") ? (
              <StatTile
                emoji="📉"
                label="Avg days to rejection"
                value={stats.avgDaysToRejection !== null ? stats.avgDaysToRejection : "N/A"}
                sub={
                  stats.avgDaysToRejection !== null
                    ? "the anticipation is the best part"
                    : "not enough data to disappoint"
                }
              />
            ) : null}
            {show("longestGhost") ? (
              <StatTile
                emoji="👻"
                label="Longest ghost"
                value={
                  stats.longestGhostDays !== null ? `${stats.longestGhostDays} days` : "N/A"
                }
                accent={stats.longestGhostDays !== null ? "text-violet" : "text-ink"}
                sub={
                  stats.longestGhostDays !== null
                    ? "of pure, uninterrupted silence"
                    : "every ghost story starts somewhere"
                }
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Badges */}
      {show("badges") ? (
      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
          🎖️ Badges <span className="text-ink-muted">({stats.badges.length} earned)</span>
        </h2>
        {stats.badges.length === 0 ? (
          <p className="mt-3 rounded-xl border border-edge bg-surface p-4 text-sm text-ink-muted">
            No badges yet. Get rejected once. It counts, and it will keep
            counting.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stats.badges.map((badge) => (
              <BadgeChip key={badge.id} badge={badge} />
            ))}
          </div>
        )}
      </section>
      ) : null}

      {/* Tombstones */}
      {show("tombstones") ? (
      <section className="mt-6 rounded-xl border border-edge bg-surface p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
          🪦 The graveyard <span className="text-ink-muted">(latest 8 closures)</span>
        </h2>
        {tombstones.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            The graveyard is empty. Nothing has officially died yet. Give it a
            week.
          </p>
        ) : (
          <ul className="mt-2">
            {tombstones.map((app) => (
              <TombstoneRow
                key={app.id}
                company={app.company}
                status={app.status}
                days={daysToTerminal(app)}
              />
            ))}
          </ul>
        )}
      </section>
      ) : null}

      {/* Footer */}
      <footer className="mt-10 flex flex-col items-center gap-3 text-center">
        <p className="max-w-xl text-sm italic text-ink-2">
          &ldquo;{funnyTagline(stats)}&rdquo;
        </p>
        <p className="text-xs text-ink-muted">
          Know someone hiring? Wrong website, but do share this page.
        </p>
        <CopyUrlButton path={`/u/${user.slug}`} label="Copy profile link" />
      </footer>
    </main>
  );
}
