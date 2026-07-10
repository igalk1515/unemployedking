// Landing page — the pitch: your rejections are proof of effort, so we made
// them a competitive ladder. Hero + live teaser stats + how it works.

import Link from "next/link";
import { getLeaderboards } from "@/lib/stats/leaderboard";
import { formatHours } from "@/components/format";
import type { Leaderboards } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadBoards(): Promise<Leaderboards | null> {
  try {
    return await getLeaderboards();
  } catch (err) {
    // Landing must render even with an empty/unmigrated database.
    console.error("[landing] leaderboards unavailable:", err);
    return null;
  }
}

interface Teaser {
  emoji: string;
  kicker: string;
  headline: string;
  sub: string;
  href: string | null;
}

function buildTeasers(boards: Leaderboards | null): Teaser[] {
  const king = boards?.king ?? null;
  const allTime = boards?.allTimeRejected[0] ?? null;
  const speedrun = boards?.speedrun[0] ?? null;

  return [
    king
      ? {
          emoji: "👑",
          kicker: "Reigning king",
          headline: king.displayName,
          sub: `${king.value} rejection${king.value === 1 ? "" : "s"} this week. Bow down.`,
          href: `/u/${king.slug}`,
        }
      : {
          emoji: "👑",
          kicker: "Reigning king",
          headline: "Throne vacant",
          sub: "Nobody has been rejected this week. Be the first.",
          href: null,
        },
    allTime
      ? {
          emoji: "💀",
          kicker: "All-time record",
          headline: allTime.displayName,
          sub: `${allTime.value} career rejections. A monument to persistence.`,
          href: `/u/${allTime.slug}`,
        }
      : {
          emoji: "💀",
          kicker: "All-time record",
          headline: "Unclaimed",
          sub: "History books are empty. Start writing yours, badly.",
          href: null,
        },
    speedrun
      ? {
          emoji: "⚡",
          kicker: "Speedrun world record",
          headline: speedrun.displayName,
          sub: `Applied → rejected in ${formatHours(speedrun.value)}. Untouchable.`,
          href: `/u/${speedrun.slug}`,
        }
      : {
          emoji: "⚡",
          kicker: "Speedrun world record",
          headline: "No runs yet",
          sub: "Someone apply somewhere terrible, quick.",
          href: null,
        },
  ];
}

const HOW_IT_WORKS: { emoji: string; title: string; body: string }[] = [
  {
    emoji: "📥",
    title: "Connect Gmail (read-only)",
    body: "We detect the “unfortunately”s automatically: rejections, ghostings, even the rare interview. Bodies counted, never stored.",
  },
  {
    emoji: "🧮",
    title: "Every rejection is XP",
    body: "Levels, badges, streaks. League-style mastery pages for losing. Rejections are proof of effort. Celebrating them is the point.",
  },
  {
    emoji: "👑",
    title: "Climb the weekly ladder",
    body: "The most rejected player each week is crowned Unemployed King. A public profile to share, so your suffering finally networks for you.",
  },
];

export default async function HomePage() {
  const boards = await loadBoards();
  const teasers = buildTeasers(boards);

  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(250,178,25,0.10),transparent_60%)]"
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 pb-16 pt-20 text-center sm:px-6 sm:pt-28">
          <div
            aria-hidden="true"
            className="text-[6rem] leading-none drop-shadow-[0_0_40px_rgba(250,178,25,0.35)] sm:text-[8rem]"
          >
            👑
          </div>
          <h1 className="mt-6 text-5xl font-extrabold tracking-tight sm:text-7xl">
            Get rejected.
            <br />
            <span className="text-gold">Get ranked.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-2">
            The job market is a competitive ladder. Literally.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="rounded-xl bg-gold px-6 py-3 text-base font-bold text-bg transition-colors hover:bg-gold/85"
            >
              Start losing →
            </Link>
            <Link
              href="/leaderboard"
              className="rounded-xl border border-edge bg-surface px-6 py-3 text-base font-semibold text-ink-2 transition-colors hover:border-gold/50 hover:text-ink"
            >
              See the leaderboard
            </Link>
          </div>
          <p className="mt-5 text-xs text-ink-muted">
            Read-only Gmail access. We only count the bodies. We never touch
            them.
          </p>
        </div>
      </section>

      {/* Teaser stats */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-muted">
          This week in unemployment
        </h2>
        {boards === null ? (
          <div className="mt-4 rounded-xl border border-edge bg-surface p-5 text-sm text-ink-2">
            <p className="font-semibold text-ink">
              <span aria-hidden="true">🔌</span> The database is also unemployed.
            </p>
            <p className="mt-1 text-ink-muted">
              Run <code className="rounded bg-bg px-1.5 py-0.5">npx prisma migrate dev</code>{" "}
              and <code className="rounded bg-bg px-1.5 py-0.5">npm run seed</code>{" "}
              to give it a job.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {teasers.map((teaser) => {
              const card = (
                <div className="flex h-full flex-col rounded-xl border border-edge bg-surface p-5 transition-colors group-hover:border-gold/50">
                  <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                    <span aria-hidden="true">{teaser.emoji}</span>{" "}
                    {teaser.kicker}
                  </span>
                  <span className="mt-2 truncate text-xl font-bold text-ink">
                    {teaser.headline}
                  </span>
                  <span className="mt-1 text-sm text-ink-2">{teaser.sub}</span>
                </div>
              );
              return teaser.href ? (
                <Link key={teaser.kicker} href={teaser.href} className="group">
                  {card}
                </Link>
              ) : (
                <div key={teaser.kicker}>{card}</div>
              );
            })}
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="border-t border-edge bg-surface/40">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight">
            How it works{" "}
            <span className="text-ink-muted">(it barely has to)</span>
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => (
              <div
                key={step.title}
                className="rounded-xl border border-edge bg-surface p-5"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-2xl">
                    {step.emoji}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                    Step {i + 1}
                  </span>
                </div>
                <h3 className="mt-3 text-base font-semibold text-ink">
                  {step.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-16 text-center sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight">
          Your inbox is already full of losses.
        </h2>
        <p className="mt-3 text-ink-2">
          Might as well get a crown for them.
        </p>
        <Link
          href="/login"
          className="mt-7 rounded-xl bg-gold px-6 py-3 text-base font-bold text-bg transition-colors hover:bg-gold/85"
        >
          Claim your throne
        </Link>
      </section>
    </main>
  );
}
