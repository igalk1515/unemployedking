// /login — the throne room door. Dark, crowned, and honest about your odds.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GoogleConnect } from "@/components/GoogleConnect";
import { requestAccess, signInWithDev } from "./actions";

export const metadata: Metadata = {
  title: "Enter the Throne Room · UnemployedKing 👑",
  description: "Sign in to start losing professionally. Get rejected. Get ranked.",
};

const ERROR_COPY: Record<string, string> = {
  BadUsername:
    "That username got auto-rejected in under a second. 2-32 characters: letters, numbers, dots, dashes.",
  Configuration:
    "The server misplaced its own credentials. Honestly? Relatable. (Check the env vars.)",
  AccessDenied:
    "Access denied. Rejected by the rejection tracker. That has to count for a badge.",
  Verification: "That link expired faster than a LinkedIn 'easy apply'. Try again.",
  OAuthCallbackError: "Google ghosted us mid-handshake. Classic. Try again.",
  CredentialsSignin:
    "Dev login didn't like that. 2-32 characters: letters, numbers, dots, dashes.",
};

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return (
    ERROR_COPY[code] ??
    "Something went wrong. Toss it on the rejection pile and try again."
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const sp = await searchParams;
  const error = errorMessage(typeof sp.error === "string" ? sp.error : undefined);
  const callbackUrl = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/dashboard";
  const requested = sp.requested === "1";
  const requestError = sp.requestError === "1";

  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID);
  const devEnabled = process.env.DEV_LOGIN === "true";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0d0d0d] px-6 py-16 text-white">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="mb-10 text-center">
          <div aria-hidden="true" className="mb-4 text-7xl leading-none">
            👑
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Unemployed<span className="text-[#fab219]">King</span>
          </h1>
          <p className="mt-3 text-lg font-medium text-[#c3c2b7]">
            Get rejected. Get ranked.
          </p>
          <p className="mt-2 text-sm text-[#898781]">
            Every &ldquo;we decided to move forward with other candidates&rdquo; is XP.
            Sign in and start climbing the ladder, downwards.
          </p>
        </div>

        {/* Error banner */}
        {error ? (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-[#d03b3b]/50 bg-[#d03b3b]/10 px-4 py-3 text-sm text-[#e66767]"
          >
            💀 {error}
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/10 bg-[#1a1a19] p-6 shadow-xl">
          {googleEnabled ? (
            <GoogleConnect callbackUrl={callbackUrl} />
          ) : (
            <div className="rounded-lg border border-white/10 bg-[#0d0d0d] px-4 py-3 text-xs text-[#898781]">
              <span className="font-semibold text-[#c3c2b7]">Google login is off.</span>{" "}
              Set <code className="text-[#c3c2b7]">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="text-[#c3c2b7]">GOOGLE_CLIENT_SECRET</code> in{" "}
              <code className="text-[#c3c2b7]">.env</code> to enable Gmail-powered
              rejection harvesting (see README).
            </div>
          )}

          {googleEnabled && devEnabled ? (
            <div className="my-6 flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs uppercase tracking-widest text-[#898781]">or</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>
          ) : null}

          {devEnabled ? (
            <form action={signInWithDev} className={googleEnabled ? "" : "mt-4"}>
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <label
                htmlFor="dev-username"
                className="mb-2 block text-sm font-medium text-[#c3c2b7]"
              >
                Dev mode: walk in without an interview
              </label>
              <div className="flex gap-2">
                <input
                  id="dev-username"
                  name="username"
                  type="text"
                  required
                  minLength={2}
                  maxLength={32}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*"
                  placeholder="sir-rejects-a-lot"
                  autoComplete="username"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0d0d0d] px-3 py-2.5 text-sm text-white placeholder-[#898781] outline-none focus:border-[#fab219]/60"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-[#fab219] px-4 py-2.5 text-sm font-semibold text-[#0d0d0d] transition-colors hover:bg-[#fab219]/85"
                >
                  Claim throne
                </button>
              </div>
              <p className="mt-2 text-xs text-[#898781]">
                No password. No background check. The only hiring process that has ever
                said yes to you on the first try.
              </p>
            </form>
          ) : null}

          {!googleEnabled && !devEnabled ? (
            <div className="mt-4 rounded-lg border border-[#d03b3b]/40 bg-[#d03b3b]/10 px-4 py-3 text-sm text-[#e66767]">
              No login methods configured. The door to the throne room is painted on.
              Set <code>GOOGLE_CLIENT_ID</code>/<code>GOOGLE_CLIENT_SECRET</code> or{" "}
              <code>DEV_LOGIN=&quot;true&quot;</code> in <code>.env</code>.
            </div>
          ) : null}
        </div>

        {/* Invite-list request — for people who aren't test users yet */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-[#1a1a19] p-5">
          <h2 className="text-sm font-semibold text-white">
            Not on the guest list yet?
          </h2>
          <p className="mt-1 text-xs text-[#898781]">
            We&rsquo;re in invite-only testing. Drop your Gmail and you&rsquo;ll be
            knighted once the King approves you.
          </p>
          {requested ? (
            <p className="mt-3 rounded-lg border border-[#3ba55d]/40 bg-[#3ba55d]/10 px-3 py-2 text-xs text-[#5fd08a]">
              👑 You&rsquo;re on the list. Once you&rsquo;re approved, come back and
              sign in with Google (and remember to tick the Gmail box).
            </p>
          ) : (
            <form action={requestAccess} className="mt-3 flex gap-2">
              <input
                name="email"
                type="email"
                required
                placeholder="you@gmail.com"
                autoComplete="email"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0d0d0d] px-3 py-2.5 text-sm text-white placeholder-[#898781] outline-none focus:border-[#fab219]/60"
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg bg-[#fab219] px-4 py-2.5 text-sm font-semibold text-[#0d0d0d] transition-colors hover:bg-[#fab219]/85"
              >
                Request
              </button>
            </form>
          )}
          {requestError ? (
            <p className="mt-2 text-xs text-[#e66767]">
              That email didn&rsquo;t take. Make sure it&rsquo;s a real address and
              try again.
            </p>
          ) : null}
        </div>

        <p className="mt-8 text-center text-xs text-[#898781]">
          The job market is a competitive ladder. Literally. 👑
        </p>
      </div>
    </main>
  );
}
