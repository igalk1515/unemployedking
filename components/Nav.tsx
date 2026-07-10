// Global top navigation. Deliberately static (no session lookup) so it never
// forces pages dynamic on its own; the proxy bounces logged-out visitors who
// click "Dashboard" to /login anyway.

import Link from "next/link";

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/85 backdrop-blur">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6"
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-base font-bold tracking-tight text-ink transition-colors hover:text-gold"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            👑
          </span>
          <span>
            Unemployed<span className="text-gold">King</span>
          </span>
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href="/leaderboard"
            className="rounded-lg px-3 py-1.5 font-medium text-ink-2 transition-colors hover:bg-white/5 hover:text-ink"
          >
            Leaderboard
          </Link>
          <Link
            href="/dashboard"
            title="The war room"
            className="rounded-lg bg-gold px-3 py-1.5 font-semibold text-bg transition-colors hover:bg-gold/85"
          >
            Dashboard
          </Link>
        </div>
      </nav>
    </header>
  );
}
