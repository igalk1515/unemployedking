// Rendered (with a real 404 status) when /u/[slug] points at nobody —
// unknown slug, private profile, or a royal who escaped the kingdom.

import Link from "next/link";

export default function NotFoundRoyal() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-24 text-center sm:px-6">
      <div aria-hidden="true" className="text-7xl leading-none opacity-70">
        🪦
      </div>
      <h1 className="mt-6 text-3xl font-extrabold tracking-tight">
        No such royal in this kingdom
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        Either the link is wrong, this profile went private, or they finally
        got hired and burned the evidence. We respect all three.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/leaderboard"
          className="rounded-xl bg-gold px-5 py-2.5 text-sm font-bold text-bg transition-colors hover:bg-gold/85"
        >
          Meet royals who exist
        </Link>
        <Link
          href="/"
          className="rounded-xl border border-edge bg-surface px-5 py-2.5 text-sm font-semibold text-ink-2 transition-colors hover:border-gold/50 hover:text-ink"
        >
          Back to the kingdom
        </Link>
      </div>
    </main>
  );
}
