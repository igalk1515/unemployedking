"use client";

// The "Connect Google" button, with a coaching interstitial before the redirect.
// Two things reliably trip first-timers on Google's own screens: the app is
// unverified (we're in testing), and the Gmail read scope is an UNCHECKED box
// they must tick. We show a plain-HTML mock of both, then hand off to Google.

import { useState } from "react";
import { signInWithGoogle } from "@/app/login/actions";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

export function GoogleConnect({ callbackUrl }: { callbackUrl: string }) {
  const [showGuide, setShowGuide] = useState(false);

  if (!showGuide) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-[#0d0d0d] transition-colors hover:bg-[#c3c2b7]"
        >
          <GoogleIcon />
          Connect Google &amp; count the bodies
        </button>
        <p className="mt-3 text-center text-xs text-[#898781]">
          Read-only Gmail access. We can see the rejections, we can never reply,
          send, or delete. The shame stays between us.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">
          Two things Google throws at you 👇
        </h2>
        <p className="mt-1 text-xs text-[#898781]">
          Get these right or the throne room stays empty. Takes 5 seconds.
        </p>
      </div>

      {/* Step 1 — the unverified / testing warning */}
      <div className="rounded-lg border border-white/10 bg-[#0d0d0d] p-3">
        <p className="text-xs font-semibold text-[#fab219]">
          1. &ldquo;Google hasn&rsquo;t verified this app&rdquo;
        </p>
        <p className="mt-1 text-xs text-[#c3c2b7]">
          That&rsquo;s us — we&rsquo;re in testing, not shady. Click{" "}
          <span className="font-semibold text-white">Advanced</span> →{" "}
          <span className="font-semibold text-white">Go to unemployedking.com</span>.
        </p>
      </div>

      {/* Step 2 — the Gmail checkbox (a mock, not a real screenshot) */}
      <div className="rounded-lg border border-white/10 bg-[#0d0d0d] p-3">
        <p className="text-xs font-semibold text-[#fab219]">
          2. Tick the Gmail box — it starts UNCHECKED
        </p>
        <div className="mt-2 rounded-md border border-white/10 bg-[#1a1a19] p-3">
          <p className="text-[11px] text-[#898781]">
            unemployedking wants to access your Google Account
          </p>
          <ul className="mt-2 space-y-1.5">
            <li className="flex items-center gap-2 text-[11px] text-[#898781]">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-[#898781] text-[9px]">
                ✓
              </span>
              See your primary email address
            </li>
            <li className="flex items-center gap-2 rounded-md bg-[#fab219]/10 p-1.5 text-[11px] font-semibold text-white ring-1 ring-[#fab219]/50">
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 border-[#fab219] bg-[#fab219] text-[9px] text-[#0d0d0d]">
                ✓
              </span>
              Read your email messages and settings
              <span className="ml-auto whitespace-nowrap text-[10px] font-bold text-[#fab219]">
                ← TICK THIS
              </span>
            </li>
          </ul>
        </div>
        <p className="mt-2 text-[11px] text-[#898781]">
          No tick, no sync. It&rsquo;s the entire reason we&rsquo;re here.
        </p>
      </div>

      <form action={signInWithGoogle}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-[#0d0d0d] transition-colors hover:bg-[#c3c2b7]"
        >
          <GoogleIcon />
          Got it — continue to Google →
        </button>
      </form>
      <button
        type="button"
        onClick={() => setShowGuide(false)}
        className="w-full text-center text-xs text-[#898781] underline-offset-2 hover:underline"
      >
        ← back
      </button>
    </div>
  );
}
