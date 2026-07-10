// GET /api/cron/auto-sync — scheduled recurring Gmail sync for users who chose
// a cadence (daily / weekly / custom). Auth: ?secret=<CRON_SECRET> or
// "Authorization: Bearer <CRON_SECRET>". Schedule it to run at least daily.

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { runDueSyncs } from "@/lib/gmail/autoSync";

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET is not configured on the server. Auto-sync stays parked." },
      { status: 503 },
    );
  }

  const fromQuery = request.nextUrl.searchParams.get("secret");
  const fromBearer =
    request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const authorized = [fromQuery, fromBearer].some(
    (candidate) => candidate != null && secretsMatch(candidate, expected),
  );

  if (!authorized) {
    return Response.json(
      { error: "Wrong secret. Your inbox stays unswept." },
      { status: 401 },
    );
  }

  try {
    const result = await runDueSyncs();
    return Response.json(result);
  } catch (err) {
    console.error("[api/cron/auto-sync] sweep failed:", err);
    return Response.json(
      { error: "Auto-sync sweep fell over mid-run. Check the server logs." },
      { status: 500 },
    );
  }
}
