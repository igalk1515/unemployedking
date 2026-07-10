/**
 * Read-only Gmail diagnosis: shows what the backfill query matches and how
 * the rules layer classifies each message — NOTHING is persisted. Use it to
 * tune ATS_DOMAINS / SUBJECT_PHRASES / phrase banks against a real inbox.
 *
 *   npx tsx scripts/gmail-diagnose.ts                 # default backfill query, 730d
 *   npx tsx scripts/gmail-diagnose.ts "<gmail query>" # any custom query
 */
import { db } from "../lib/db";
import {
  extractEmailInput,
  getAccessToken,
  getMessage,
  listMessageIds,
} from "../lib/gmail/client";
import { classifyByRules } from "../lib/classifier/rules";
import { BACKFILL_QUERY } from "../lib/gmail/sync";

const SAMPLE_LIMIT = 80;

async function main() {
  const acct = await db.emailAccount.findFirst({
    where: { encryptedRefreshToken: { not: null } },
  });
  if (!acct) throw new Error("No connected Gmail account found.");

  const token = await getAccessToken(acct);
  const query =
    process.argv[2] ?? BACKFILL_QUERY.replace(/newer_than:\d+d/, "newer_than:730d");
  console.log(`QUERY: ${query}\n`);

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listMessageIds(token, query, pageToken);
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < 1000);

  console.log(`TOTAL MATCHING MESSAGES: ${ids.length}`);
  console.log(`Classifying a sample of ${Math.min(ids.length, SAMPLE_LIMIT)} (newest first):\n`);

  const tally: Record<string, number> = {};
  for (const id of ids.slice(0, SAMPLE_LIMIT)) {
    const input = extractEmailInput(await getMessage(token, id));
    const cls = classifyByRules(input);
    const outcome = cls ? `${cls.event}/${cls.confidence}` : "NULL(needs-LLM)";
    tally[outcome] = (tally[outcome] ?? 0) + 1;
    console.log(
      outcome.padEnd(30),
      input.receivedAt.toISOString().slice(0, 10),
      (input.senderDomain ?? "?").padEnd(26),
      input.subject.slice(0, 70),
    );
  }

  console.log("\nTALLY:", JSON.stringify(tally, null, 1));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
