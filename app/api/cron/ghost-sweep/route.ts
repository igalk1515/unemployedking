// GET /api/cron/ghost-sweep — scheduled ghost detection.
// Auth: ?secret=<CRON_SECRET> or "Authorization: Bearer <CRON_SECRET>".

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { runGhostSweep } from "@/lib/ghost";

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET is not configured on the server. The ghosts run free." },
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
      { error: "Wrong secret. The ghosts remain unswept." },
      { status: 401 },
    );
  }

  try {
    const result = await runGhostSweep();
    return Response.json(result);
  } catch (err) {
    console.error("[api/cron/ghost-sweep] sweep failed:", err);
    return Response.json(
      { error: "Ghost sweep failed mid-séance. Check the server logs." },
      { status: 500 },
    );
  }
}
