// Next.js 16 proxy (the artist formerly known as middleware.ts).
//
// Two jobs:
//   1. Content-Security-Policy with a fresh per-request nonce. Next.js reads the
//      nonce out of the CSP header we set on the *request* and stamps it onto
//      every script tag it renders, so 'strict-dynamic' can stay on and the
//      inline bootstrap scripts still run. (Next docs: guides/content-security-policy.)
//   2. Gate /dashboard behind a valid session JWT.
//
// We deliberately decode the session cookie with `getToken` instead of pulling
// in the full auth config — the proxy runs in front of the app and should not
// drag Prisma or the provider setup into its bundle.
//
// Every other security header is static and lives in next.config.ts, so it also
// covers the static assets this matcher skips.

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const SECURE_COOKIE = "__Secure-authjs.session-token";

/**
 * A nonce covers <script> tags but NOT inline `style` attributes — CSP has no
 * nonce mechanism for attributes, and React writes a style attribute for every
 * dynamic width (the sync progress bar, the funnel bars). Hence 'unsafe-inline'
 * on style-src only. script-src stays strict, which is the directive that
 * actually stops XSS.
 *
 * 'unsafe-eval' in dev only: React uses eval there to rebuild server error stacks.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  if (request.nextUrl.pathname.startsWith("/dashboard")) {
    const gate = await guardDashboard(request);
    if (gate) {
      gate.headers.set("Content-Security-Policy", csp);
      // A bodyless redirect with no Content-Type reads as a finding to scanners.
      gate.headers.set("Content-Type", "text/plain; charset=utf-8");
      return gate;
    }
  }

  // Next.js extracts the nonce from the CSP header on the *request* and applies
  // it to the scripts it renders; x-nonce is there for any server component that
  // wants to read it directly.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/** Returns a redirect when this request may NOT see /dashboard, else null. */
async function guardDashboard(request: NextRequest): Promise<NextResponse | null> {
  const loginUrl = new URL("/login", request.nextUrl.origin);

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error("[proxy] AUTH_SECRET is not set — cannot validate sessions. See .env.example.");
    loginUrl.searchParams.set("error", "Configuration");
    return NextResponse.redirect(loginUrl);
  }

  // Auth.js prefixes the cookie with __Secure- on HTTPS deployments (and chunks
  // it as `.0`, `.1`, ... when large) — detect which flavor this request carries.
  const secureCookie =
    request.cookies.getAll().some((c) => c.name.startsWith(SECURE_COOKIE)) ||
    request.nextUrl.protocol === "https:";

  const token = await getToken({ req: request, secret, secureCookie });
  if (!token) {
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return null;
}

export const config = {
  // Every page gets the CSP. Static assets and image optimization are skipped
  // (no scripts there, and next.config.ts already covers them), as are router
  // prefetches — per the Next.js CSP guide.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
