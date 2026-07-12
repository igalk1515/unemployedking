// scripts/classifier-report.ts — who found what: rules (free) vs LLM (billed).
//
//   npm run classifier:report
//
// Reads Event.classifierLayer, which the sync pipeline stamps on every
// email-sourced event. Events recorded BEFORE that column existed have a null
// layer and are reported separately as "unattributed" — they cannot be
// backfilled, because we never store email content (Data rule 4), so there is
// nothing left to re-classify.
//
// NOTE: this reports events *persisted* per layer. It cannot see billed LLM
// calls that produced nothing (mail Gemini read and judged irrelevant) — that
// number is only in the sync logs (`[sync/…] llm=calls→events`).

import { db } from "../lib/db";

const pct = (n: number, total: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—");

async function main(): Promise<void> {
  const rows = await db.event.groupBy({
    by: ["classifierLayer", "type"],
    where: { source: "email" },
    _count: { _all: true },
  });

  const byLayer = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const layer = r.classifierLayer ?? "unattributed (pre-instrumentation)";
    const inner = byLayer.get(layer) ?? new Map<string, number>();
    inner.set(r.type, (inner.get(r.type) ?? 0) + r._count._all);
    byLayer.set(layer, inner);
  }

  const totalEmailEvents = rows.reduce((sum, r) => sum + r._count._all, 0);

  console.log("\n=== Email events by classifier layer ===\n");
  if (totalEmailEvents === 0) {
    console.log("No email-sourced events yet.\n");
    return;
  }

  for (const [layer, types] of [...byLayer.entries()].sort()) {
    const layerTotal = [...types.values()].reduce((a, b) => a + b, 0);
    const cost =
      layer === "llm" ? " — billed Gemini calls" : layer === "rules" ? " — free, no network" : "";
    console.log(`${layer}: ${layerTotal} (${pct(layerTotal, totalEmailEvents)})${cost}`);
    for (const [type, n] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${type.padEnd(10)} ${String(n).padStart(6)}`);
    }
    console.log();
  }

  const attributed = (byLayer.get("rules")?.size ?? 0) + (byLayer.get("llm")?.size ?? 0);
  if (attributed === 0) {
    console.log(
      "Every email event predates the classifierLayer column, so nothing can be\n" +
        "attributed yet. Run a sync and re-run this report.\n",
    );
  }

  // Per-user split, so you can see whose inbox is expensive.
  const perUser = await db.$queryRaw<
    { slug: string; rules: number; llm: number; unattributed: number }[]
  >`
    SELECT u.slug,
           count(*) FILTER (WHERE e."classifierLayer" = 'rules')::int AS rules,
           count(*) FILTER (WHERE e."classifierLayer" = 'llm')::int   AS llm,
           count(*) FILTER (WHERE e."classifierLayer" IS NULL)::int   AS unattributed
    FROM "Event" e
    JOIN "User" u ON u.id = e."userId"
    WHERE e.source = 'email'
    GROUP BY u.slug
    ORDER BY llm DESC, rules DESC`;

  console.log("=== Per user ===\n");
  console.log("slug".padEnd(22) + "rules".padStart(8) + "llm".padStart(8) + "unattrib.".padStart(12));
  for (const r of perUser) {
    console.log(
      r.slug.padEnd(22) +
        String(r.rules).padStart(8) +
        String(r.llm).padStart(8) +
        String(r.unattributed).padStart(12),
    );
  }
  console.log();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
