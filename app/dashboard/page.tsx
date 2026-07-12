// /dashboard — the war room. Sync the inbox, log manual losses, watch the
// numbers go up (the wrong numbers, but up).

import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import {
  getApplicationsWithStatus,
  getProfileStats,
} from '@/lib/stats/profile';
import { MAX_AUTO_SYNC_INTERVAL_DAYS } from '@/lib/gmail/autoSync';
import { parseHiddenProfileFields } from '@/lib/types';
import type { ApplicationStatus, ApplicationWithStatus } from '@/lib/types';
import { AccessRequestsCard } from '@/components/AccessRequestsCard';
import { AutoSyncForm } from '@/components/AutoSyncForm';
import { CopyUrlButton } from '@/components/CopyUrlButton';
import { ManualAddForm } from '@/components/ManualAddForm';
import { PrivacyForm } from '@/components/PrivacyForm';
import { StatTile } from '@/components/StatTile';
import { EVENT_THEME, StatusChip } from '@/components/StatusChip';
import { SyncButton } from '@/components/SyncButton';
import {
  formatDateUTC,
  monthYearUTC,
  timeAgo,
  todayISOUTC,
} from '@/components/format';
import {
  signOutAction,
  updateDisplayName,
  updateSyncSettings,
} from './actions';

const WINDOW_OPTIONS: { days: number; label: string }[] = [
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
  // { days: 730, label: "2 years (max)" },
];

function windowLabel(days: number): string {
  return WINDOW_OPTIONS.find((o) => o.days === days)?.label ?? `${days} days`;
}

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'The war room. Sync rejections, log losses, admire the damage.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function firstString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

type GmailState =
  | {
      kind: 'connected';
      address: string;
      lastSyncedAt: Date | null;
      backfillDone: boolean;
    }
  | { kind: 'reconnect'; address: string }
  | { kind: 'disconnected' }
  | { kind: 'unconfigured' };

async function getGmailState(userId: string): Promise<GmailState> {
  const account = await db.emailAccount.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      emailAddress: true,
      encryptedRefreshToken: true,
      lastSyncedAt: true,
      backfillDone: true,
    },
  });

  if (account?.encryptedRefreshToken) {
    return {
      kind: 'connected',
      address: account.emailAddress,
      lastSyncedAt: account.lastSyncedAt,
      backfillDone: account.backfillDone,
    };
  }
  if (account) return { kind: 'reconnect', address: account.emailAddress };
  if (process.env.GOOGLE_CLIENT_ID) return { kind: 'disconnected' };
  return { kind: 'unconfigured' };
}

/**
 * The primary call-to-action: front and center under the header, not buried
 * in a settings card. Only renders when a Gmail account is actually synced.
 */
function SyncHero({
  state,
  backfillWindowDays,
}: {
  state: Extract<GmailState, { kind: 'connected' }>;
  backfillWindowDays: number;
}) {
  return (
    <section
      aria-label="Gmail sync"
      className="mt-6 rounded-xl border-2 border-gold/40 bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gold">
          📥 Harvest your inbox
        </h2>
        <p className="text-xs text-ink-muted">
          <span className="font-medium text-ink-2">{state.address}</span>
          {' · '}
          {state.lastSyncedAt
            ? `last swept ${timeAgo(state.lastSyncedAt)}`
            : 'never synced'}
        </p>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {state.lastSyncedAt
          ? state.backfillDone
            ? 'Pull whatever bad news arrived since last time. Newest mail lands first.'
            : 'The backfill is still mid-dig — hit Sync to keep excavating. Newest mail lands first.'
          : `First sync digs through the last ${windowLabel(backfillWindowDays)} of damage, newest mail first.`}
      </p>
      <div className="mt-3">
        <SyncButton />
      </div>
    </section>
  );
}

function GmailCard({
  state,
  backfillWindowDays,
  autoSyncIntervalDays,
}: {
  state: GmailState;
  backfillWindowDays: number;
  autoSyncIntervalDays: number | null;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-edge bg-surface p-4 sm:p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
        📥 Gmail intake
      </h2>

      {state.kind === 'connected' ? (
        <div className="mt-3 flex flex-1 flex-col">
          <p className="text-sm text-ink">
            <span aria-hidden="true">🔗</span> Connected as{' '}
            <span className="font-semibold">{state.address}</span>
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {state.lastSyncedAt
              ? `Last swept for bad news ${timeAgo(state.lastSyncedAt)}.`
              : `Never synced. The first run digs through the last ${windowLabel(backfillWindowDays)} of damage.`}
            {state.backfillDone ? '' : ' Backfill still pending.'}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Read-only. We count the bodies. We never touch them. The Sync
            button lives in the big gold panel up top.
          </p>
          <form
            action={updateSyncSettings}
            className="mt-4 flex flex-wrap items-center gap-2 border-t border-edge pt-3"
          >
            <label
              htmlFor="backfillWindowDays"
              className="text-xs text-ink-muted"
            >
              ⛏️ Dig depth
            </label>
            <select
              id="backfillWindowDays"
              name="backfillWindowDays"
              defaultValue={String(backfillWindowDays)}
              className="rounded-lg border border-edge bg-bg px-2 py-1.5 text-xs text-ink"
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-gold/50 hover:text-ink"
            >
              Save
            </button>
            <p className="w-full text-xs text-ink-muted">
              How far back the excavation goes. Deepen it and the next sync
              re-digs. Two years is the legal limit on self-archaeology.
            </p>
          </form>
          <AutoSyncForm
            intervalDays={autoSyncIntervalDays}
            maxIntervalDays={MAX_AUTO_SYNC_INTERVAL_DAYS}
          />
        </div>
      ) : null}

      {state.kind === 'reconnect' ? (
        <div className="mt-3 flex flex-1 flex-col">
          <p className="text-sm text-ink">
            <span aria-hidden="true">🔌</span>{' '}
            <span className="font-semibold">{state.address}</span> is signed in,
            but we have no read access to the inbox.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Almost always this means the{' '}
            <span className="font-semibold text-ink-2">
              &ldquo;Read your email messages and settings&rdquo;
            </span>{' '}
            box didn&apos;t get ticked during Google sign-in — it&apos;s unchecked
            by default. Reconnect and check that one box. It&apos;s the only thing
            between you and a fully-stocked graveyard.
          </p>
          <Link
            href="/login"
            className="mt-4 self-start rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-gold/85"
          >
            Reconnect Gmail
          </Link>
        </div>
      ) : null}

      {state.kind === 'disconnected' ? (
        <div className="mt-3 flex flex-1 flex-col">
          <p className="text-sm text-ink">
            <span aria-hidden="true">📭</span> No inbox connected.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Your rejections are sitting in Gmail right now, unappreciated. Sign
            in with Google (read-only) and we&apos;ll turn them into XP.
          </p>
          <Link
            href="/login"
            className="mt-4 self-start rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-gold/85"
          >
            Connect Gmail
          </Link>
        </div>
      ) : null}

      {state.kind === 'unconfigured' ? (
        <div className="mt-3 flex flex-1 flex-col">
          <p className="text-sm text-ink">
            <span aria-hidden="true">🔧</span> Gmail sync is not configured on
            this server.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Set{' '}
            <code className="rounded bg-bg px-1 py-0.5">GOOGLE_CLIENT_ID</code>{' '}
            and{' '}
            <code className="rounded bg-bg px-1 py-0.5">
              GOOGLE_CLIENT_SECRET
            </code>{' '}
            in <code className="rounded bg-bg px-1 py-0.5">.env</code> (see the
            README walkthrough). Until then, the manual form works great, it has
            a 100% response rate, which is more than the market offers.
          </p>
        </div>
      ) : null}
    </section>
  );
}

const APPS_PAGE_SIZE = 25;
// Active/hopeful first, terminal last: the war-room reading order.
const STATUS_ORDER: ApplicationStatus[] = [
  'offer',
  'interview',
  'applied',
  'rejected',
  'ghosted',
];

function isStatus(value: string | null): value is ApplicationStatus {
  return value !== null && (STATUS_ORDER as string[]).includes(value);
}

// How the applications table clusters its rows. Status is the default (and the
// historical behavior); company and month are the alternatives.
type GroupBy = 'status' | 'company' | 'month';

const GROUP_OPTIONS: { key: GroupBy; emoji: string; label: string }[] = [
  { key: 'status', emoji: '🚦', label: 'Status' },
  { key: 'company', emoji: '🏢', label: 'Company' },
  { key: 'month', emoji: '🗓️', label: 'Month applied' },
];

function isGroupBy(value: string | null): value is GroupBy {
  return value === 'status' || value === 'company' || value === 'month';
}

/** Sortable UTC month key, e.g. "2026-07". */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The group an application falls into under the current grouping. */
function groupKeyOf(app: ApplicationWithStatus, groupBy: GroupBy): string {
  if (groupBy === 'company') return app.company.trim().toLowerCase() || '(unknown)';
  if (groupBy === 'month') return monthKey(app.appliedAt);
  return app.status;
}

/** Display for a group header row: emoji, label, and the color class to wear. */
function groupHeaderFor(
  app: ApplicationWithStatus,
  groupBy: GroupBy,
): { emoji: string; label: string; textClass: string } {
  if (groupBy === 'company') {
    return { emoji: '🏢', label: app.company || 'Unknown company', textClass: 'text-ink-2' };
  }
  if (groupBy === 'month') {
    return { emoji: '🗓️', label: monthYearUTC(app.appliedAt), textClass: 'text-ink-2' };
  }
  const theme = EVENT_THEME[app.status];
  return { emoji: theme.emoji, label: theme.label, textClass: theme.textClass };
}

/** A /dashboard href carrying the applications status filter, grouping + page. */
function appsHref(status: string, page: number, group: GroupBy): string {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('appsStatus', status);
  if (group !== 'status') params.set('appsGroup', group);
  if (page > 1) params.set('appsPage', String(page));
  const qs = params.toString();
  return qs ? `/dashboard?${qs}` : '/dashboard';
}

function ApplicationsBrowser({
  applications,
  activeStatus,
  groupBy,
  page,
}: {
  applications: ApplicationWithStatus[];
  activeStatus: ApplicationStatus | 'all';
  groupBy: GroupBy;
  page: number;
}) {
  if (applications.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-edge bg-surface p-5 text-sm text-ink-muted">
        <span aria-hidden="true">🦗</span> No applications tracked yet. Sync
        Gmail or log one manually. These tombstones won&apos;t carve themselves.
      </p>
    );
  }

  // Counts per status across the whole set (drives the tab badges).
  const counts = {} as Record<ApplicationStatus, number>;
  for (const app of applications) {
    counts[app.status] = (counts[app.status] ?? 0) + 1;
  }

  // Filter to the active status, then cluster into groups under the chosen
  // dimension. Applications arrive lastEventAt-desc; pushing in arrival order
  // preserves that recency ordering within every group.
  const filtered =
    activeStatus === 'all'
      ? applications
      : applications.filter((a) => a.status === activeStatus);

  const groups = new Map<string, ApplicationWithStatus[]>();
  for (const app of filtered) {
    const key = groupKeyOf(app, groupBy);
    const bucket = groups.get(key);
    if (bucket) bucket.push(app);
    else groups.set(key, [app]);
  }

  // Order the groups: status by war-room priority, company by size (your most
  // frequent rejectors first) then name, month newest-first.
  const rank = new Map(STATUS_ORDER.map((s, i) => [s, i]));
  const orderedKeys = [...groups.keys()];
  if (groupBy === 'status') {
    orderedKeys.sort(
      (a, b) =>
        (rank.get(a as ApplicationStatus) ?? 9) -
        (rank.get(b as ApplicationStatus) ?? 9),
    );
  } else if (groupBy === 'company') {
    orderedKeys.sort((a, b) => {
      const bySize = (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0);
      return bySize !== 0 ? bySize : a.localeCompare(b);
    });
  } else {
    orderedKeys.sort((a, b) => b.localeCompare(a));
  }
  const ordered = orderedKeys.flatMap((key) => groups.get(key) ?? []);

  const total = ordered.length;
  const pageCount = Math.max(1, Math.ceil(total / APPS_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * APPS_PAGE_SIZE;
  const slice = ordered.slice(start, start + APPS_PAGE_SIZE);

  const tabs = [
    {
      key: 'all' as const,
      emoji: '📋',
      label: 'All',
      count: applications.length,
    },
    ...STATUS_ORDER.filter((s) => counts[s]).map((s) => ({
      key: s,
      emoji: EVENT_THEME[s].emoji,
      label: EVENT_THEME[s].label,
      count: counts[s],
    })),
  ];

  return (
    <>
      {/* Group-by selector */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-muted">Group by</span>
        {GROUP_OPTIONS.map((opt) => {
          const active = opt.key === groupBy;
          return (
            <Link
              key={opt.key}
              href={appsHref(activeStatus, 1, opt.key)}
              aria-current={active ? 'true' : undefined}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium transition-colors ${
                active
                  ? 'border-gold/60 bg-white/5 text-ink'
                  : 'border-edge text-ink-2 hover:border-gold/40 hover:text-ink'
              }`}
            >
              <span aria-hidden="true">{opt.emoji}</span>
              {opt.label}
            </Link>
          );
        })}
      </div>

      {/* Status filter tabs */}
      <div className="mt-2 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = tab.key === activeStatus;
          return (
            <Link
              key={tab.key}
              href={appsHref(tab.key, 1, groupBy)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-gold/60 bg-white/5 text-ink'
                  : 'border-edge text-ink-2 hover:border-gold/40 hover:text-ink'
              }`}
            >
              <span aria-hidden="true">{tab.emoji}</span>
              {tab.label}
              <span className="tabular-nums text-ink-muted">{tab.count}</span>
            </Link>
          );
        })}
      </div>

      {total === 0 ? (
        <p className="mt-3 rounded-xl border border-edge bg-surface p-5 text-sm text-ink-muted">
          Nothing in this bucket. Try another tab.
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto rounded-xl border border-edge bg-surface">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-edge text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Company
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Applied
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Days
                  </th>
                </tr>
              </thead>
              <tbody>
                {slice.map((app, i) => {
                  const showHeader =
                    i === 0 ||
                    groupKeyOf(slice[i - 1], groupBy) !==
                      groupKeyOf(app, groupBy);
                  const header = groupHeaderFor(app, groupBy);
                  const groupSize =
                    groups.get(groupKeyOf(app, groupBy))?.length ?? 0;
                  return (
                    <Fragment key={app.id}>
                      {showHeader ? (
                        <tr className="border-b border-edge bg-white/[0.03]">
                          <th
                            scope="colgroup"
                            colSpan={5}
                            className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider"
                          >
                            <span className={header.textClass}>
                              <span aria-hidden="true">{header.emoji}</span>{' '}
                              {header.label}
                            </span>
                            <span className="ml-1.5 font-normal text-ink-muted">
                              {groupSize}
                            </span>
                          </th>
                        </tr>
                      ) : null}
                      <tr className="border-b border-edge last:border-b-0 hover:bg-white/5">
                        <td className="max-w-[14rem] truncate px-4 py-2.5 font-medium text-ink">
                          {app.company}
                          {app.source === 'manual' ? (
                            <span
                              aria-label="added manually"
                              title="Logged by hand: human intent, the pipeline keeps out"
                              className="ml-1.5 text-xs"
                            >
                              ✍️
                            </span>
                          ) : null}
                        </td>
                        <td className="max-w-[14rem] truncate px-4 py-2.5 text-ink-2">
                          {app.role ?? (
                            <span className="text-ink-muted">N/A</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">
                          {formatDateUTC(app.appliedAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusChip status={app.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">
                          {app.daysSinceApplied}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 ? (
            <nav
              aria-label="Applications pagination"
              className="mt-3 flex items-center justify-between text-xs text-ink-muted"
            >
              <span className="tabular-nums">
                {start + 1}-{Math.min(start + APPS_PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                {current > 1 ? (
                  <Link
                    href={appsHref(activeStatus, current - 1, groupBy)}
                    className="rounded-lg border border-edge px-2.5 py-1 font-medium text-ink-2 transition-colors hover:border-gold/40 hover:text-ink"
                  >
                    ← Prev
                  </Link>
                ) : (
                  <span className="rounded-lg border border-edge px-2.5 py-1 opacity-40">
                    ← Prev
                  </span>
                )}
                <span className="tabular-nums">
                  Page {current} / {pageCount}
                </span>
                {current < pageCount ? (
                  <Link
                    href={appsHref(activeStatus, current + 1, groupBy)}
                    className="rounded-lg border border-edge px-2.5 py-1 font-medium text-ink-2 transition-colors hover:border-gold/40 hover:text-ink"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="rounded-lg border border-edge px-2.5 py-1 opacity-40">
                    Next →
                  </span>
                )}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await auth();
  const user = session?.user;
  // The proxy already guards /dashboard; this is the belt to its suspenders.
  if (!user?.id) redirect('/login?callbackUrl=/dashboard');

  const sp = await searchParams;
  const errorBanner = firstString(sp.error);
  const addedBanner = firstString(sp.added);
  const savedBanner = firstString(sp.saved);
  const autosyncBanner = firstString(sp.autosync);
  const privacyBanner = firstString(sp.privacy);
  const renamedBanner = firstString(sp.renamed);
  const requestsClearedBanner = firstString(sp.requestsCleared);

  const rawAppsStatus = firstString(sp.appsStatus);
  const activeStatus: ApplicationStatus | 'all' = isStatus(rawAppsStatus)
    ? rawAppsStatus
    : 'all';
  const rawAppsGroup = firstString(sp.appsGroup);
  const groupBy: GroupBy = isGroupBy(rawAppsGroup) ? rawAppsGroup : 'status';
  const appsPage = Math.max(
    1,
    Number.parseInt(firstString(sp.appsPage) ?? '1', 10) || 1,
  );

  const [gmail, stats, applications, dbUser] = await Promise.all([
    getGmailState(user.id),
    getProfileStats(user.id),
    getApplicationsWithStatus(user.id),
    db.user.findUnique({
      where: { id: user.id },
      select: {
        backfillWindowDays: true,
        autoSyncIntervalDays: true,
        displayName: true,
        publicProfile: true,
        leaderboardOptIn: true,
        hiddenProfileFields: true,
      },
    }),
  ]);
  const backfillWindowDays = dbUser?.backfillWindowDays ?? 365;
  const autoSyncIntervalDays = dbUser?.autoSyncIntervalDays ?? null;
  const displayName = dbUser?.displayName ?? null;
  const publicProfile = dbUser?.publicProfile ?? true;
  const leaderboardOptIn = dbUser?.leaderboardOptIn ?? true;
  const hiddenFields = parseHiddenProfileFields(dbUser?.hiddenProfileFields);

  const profilePath = `/u/${user.slug}`;
  const greetingName = user.name ?? user.slug ?? 'your majesty';

  // Owner-only: pending invite requests (people to add to the Google test-user
  // list while the app is in testing mode).
  const isOwner = Boolean(
    user.email &&
      process.env.OWNER_EMAIL &&
      user.email.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase(),
  );
  const pendingRequestEmails = isOwner
    ? (
        await db.accessRequest.findMany({
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
          select: { email: true },
        })
      ).map((r) => r.email)
    : [];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            The War Room
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            Welcome back,{' '}
            <span className="font-semibold text-ink">{greetingName}</span> ·{' '}
            <span className="font-semibold text-gold">
              Lv.{stats.rejectionLevel}
            </span>{' '}
            {stats.levelTitle}.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href={profilePath}
            className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:border-gold/50 hover:text-ink"
          >
            View public profile
          </Link>
          <CopyUrlButton path={profilePath} label="Copy profile link" />
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-critical/50 hover:text-red"
              title="Sign out"
            >
              Abdicate
            </button>
          </form>
        </div>
      </header>

      {/* Action-result banners (from the manual-add server action) */}
      {errorBanner ? (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-red"
        >
          <span aria-hidden="true">💀</span> {errorBanner}
        </div>
      ) : null}
      {addedBanner ? (
        <div
          role="status"
          className="mt-6 rounded-lg border border-good/40 bg-good/10 px-4 py-3 text-sm text-good"
        >
          <span aria-hidden="true">📮</span> Logged {addedBanner}. Another entry
          for the historians.
        </div>
      ) : null}
      {savedBanner ? (
        <div
          role="status"
          className="mt-6 rounded-lg border border-good/40 bg-good/10 px-4 py-3 text-sm text-good"
        >
          <span aria-hidden="true">⛏️</span> Dig depth updated. The next sync
          will excavate accordingly.
        </div>
      ) : null}
      {autosyncBanner ? (
        <div
          role="status"
          className="mt-6 rounded-lg border border-good/40 bg-good/10 px-4 py-3 text-sm text-good"
        >
          <span aria-hidden="true">🔁</span>{' '}
          {autosyncBanner === 'off'
            ? 'Auto-sync off. Back to manual excavation.'
            : `Auto-sync on: every ${autosyncBanner} day${
                autosyncBanner === '1' ? '' : 's'
              }. We’ll check your inbox so you don’t have to.`}
        </div>
      ) : null}
      {privacyBanner ? (
        <div
          role="status"
          className="mt-6 rounded-lg border border-good/40 bg-good/10 px-4 py-3 text-sm text-good"
        >
          <span aria-hidden="true">🛡️</span> Privacy settings saved. Your profile
          is now{' '}
          <span className="font-semibold">
            {privacyBanner === 'private' ? 'private (404 to everyone else)' : 'public'}
          </span>
          .
        </div>
      ) : null}
      {renamedBanner !== null ? (
        <div
          role="status"
          className="mt-6 rounded-lg border border-good/40 bg-good/10 px-4 py-3 text-sm text-good"
        >
          <span aria-hidden="true">🕶️</span> Nickname updated. Your cover is
          intact.
        </div>
      ) : null}
      {requestsClearedBanner ? (
        <div
          role="status"
          className="mt-6 rounded-lg border border-good/40 bg-good/10 px-4 py-3 text-sm text-good"
        >
          <span aria-hidden="true">✅</span> Access list cleared. New requests will
          show up here as they come in.
        </div>
      ) : null}

      {/* The main event: sync sits at the top, impossible to miss */}
      {gmail.kind === 'connected' ? (
        <SyncHero state={gmail} backfillWindowDays={backfillWindowDays} />
      ) : null}

      {/* Owner-only: friends waiting to be added to the Google test-user list */}
      {isOwner ? <AccessRequestsCard emails={pendingRequestEmails} /> : null}

      {/* Public nickname */}
      <section
        aria-label="Public nickname"
        className="mt-6 rounded-xl border border-edge bg-surface p-4 sm:p-5"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
          🕶️ Public nickname
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Shown on your public profile and the leaderboard. Pick anything.
          Nobody needs your real name to watch you get rejected.
        </p>
        <form
          action={updateDisplayName}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input
            name="displayName"
            type="text"
            maxLength={40}
            defaultValue={displayName ?? ''}
            placeholder={user.slug}
            aria-label="Public nickname"
            className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink placeholder-ink-muted outline-none focus:border-gold/60"
          />
          <button
            type="submit"
            className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-gold/85"
          >
            Save
          </button>
        </form>
        <p className="mt-2 text-xs text-ink-muted">
          Showing as{' '}
          <span className="font-semibold text-ink">
            {displayName ?? user.slug}
          </span>
          . Leave it blank to fall back to your handle{' '}
          <span className="font-mono text-ink-2">{user.slug}</span>.
        </p>
      </section>

      {/* Privacy & visibility */}
      <section
        aria-label="Privacy and visibility"
        className="mt-6 rounded-xl border border-edge bg-surface p-4 sm:p-5"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
          🛡️ Privacy &amp; visibility
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          You decide what the world sees. Go fully private, drop off the
          leaderboard, or hide individual stats you&apos;d rather not broadcast.
        </p>
        <PrivacyForm
          publicProfile={publicProfile}
          leaderboardOptIn={leaderboardOptIn}
          hiddenFields={hiddenFields}
        />
      </section>

      {/* Personal stats strip */}
      <section aria-label="Your numbers" className="mt-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile
            emoji="📨"
            label="Applied"
            value={stats.applied}
            accent="text-ink-2"
          />
          <StatTile
            emoji="💀"
            label="Rejected"
            value={stats.rejected}
            accent="text-red"
          />
          <StatTile
            emoji="👻"
            label="Ghosted"
            value={stats.ghosted}
            accent="text-violet"
          />
          <StatTile
            emoji="🎯"
            label="Interviews"
            value={stats.interviews}
            accent="text-blue"
          />
          <StatTile
            emoji="🏆"
            label="Offers"
            value={stats.offers}
            accent="text-good"
          />
          <StatTile
            emoji="⏳"
            label="Pending"
            value={stats.pending}
            sub={stats.pending > 0 ? '“under review”' : 'nothing in limbo'}
          />
        </div>
      </section>

      {/* Gmail + manual add */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GmailCard
          state={gmail}
          backfillWindowDays={backfillWindowDays}
          autoSyncIntervalDays={autoSyncIntervalDays}
        />
        <section className="rounded-xl border border-edge bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
            ✍️ Log a loss manually
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            For rejections delivered by phone, hallway shrug, or total silence.
            Manual entries are sacred. The email pipeline never overwrites them.
          </p>
          <div className="mt-4">
            <ManualAddForm todayISO={todayISOUTC()} />
          </div>
        </section>
      </div>

      {/* Applications table */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">
            📋 Applications{' '}
            <span className="text-ink-muted">({applications.length})</span>
          </h2>
          {stats.currentStreakWeeks >= 2 ? (
            <p className="text-xs text-ink-muted">
              🔥 {stats.currentStreakWeeks}-week rejection streak. Keep it
              alive.
            </p>
          ) : null}
        </div>
        <ApplicationsBrowser
          applications={applications}
          activeStatus={activeStatus}
          groupBy={groupBy}
          page={appsPage}
        />
      </section>
    </main>
  );
}
