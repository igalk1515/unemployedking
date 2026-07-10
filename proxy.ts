// Next.js 16 proxy (the artist formerly known as middleware.ts):
// gate /dashboard behind a valid session JWT.
//
// We deliberately decode the session cookie with `getToken` instead of pulling
// in the full auth config — the proxy runs in front of the app and should not
// drag Prisma or the provider setup into its bundle.

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const SECURE_COOKIE = "__Secure-authjs.session-token";

export async function proxy(request: NextRequest) {
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
