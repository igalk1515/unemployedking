// UnemployedKing demo seed. Run with `npm run seed` or `npx prisma db seed`.
//
// - Deterministic: fixed-seed PRNG for all choices; timelines are fixed
//   offsets anchored to `new Date()` at run time (never Date-dependent
//   randomness), so reseeding is stable.
// - Idempotent: demo users (emails ending @demo.unemployedking.local) are
//   deleted and recreated on every run.
// - Guarantees: a clear current-week king (queen-of-nothing), multiple
//   speedrun entries under 1 hour, one necromancer case (necro-nancy),
//   exactly one offer (the-optimist), and ghosted cases via system events.
//
// NOTE: this file runs under tsx WITHOUT Next's "@/*" path alias — relative
// imports only, and nothing imported here may transitively use the alias.

import { db } from "../lib/db";
import type { Confidence, EventSource, EventType } from "../lib/types";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const DEMO_EMAIL_SUFFIX = "@demo.unemployedking.local";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

/** Integer in [min, max], inclusive. */
const int = (rng: Rng, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));

const pick = <T,>(rng: Rng, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)];

function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Time anchors — all offsets are relative to `now`, computed once per run.
// ---------------------------------------------------------------------------

const now = new Date();

/** Monday 00:00 UTC of the ISO week containing `d` (local copy — the lib/stats
 * version lives behind "@/*" imports which tsx does not resolve). */
function isoWeekStartUtc(d: Date): Date {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday)
  );
}

const weekStartMs = isoWeekStartUtc(now).getTime();
const weekElapsedMs = now.getTime() - weekStartMs;

const daysAgo = (days: number) => new Date(now.getTime() - Math.round(days * DAY_MS));

/** A timestamp guaranteed inside the current ISO week (and not after `now`,
 * beyond a 1ms edge if seeding exactly at Monday 00:00). fraction ∈ (0, 1). */
const inCurrentWeek = (fraction: number) =>
  new Date(weekStartMs + Math.max(1, Math.floor(weekElapsedMs * fraction)));

// ---------------------------------------------------------------------------
// Fixture pools
// ---------------------------------------------------------------------------

const COMPANIES = [
  "Initech",
  "Hooli",
  "Pied Piper",
  "Dunder Mifflin",
  "Umbrella Corp",
  "Aperture Science",
  "ACME",
  "Globex",
  "Massive Dynamic",
  "Wayne Enterprises",
  "Stark Industries",
  "Wonka Industries",
  "Cyberdyne Systems",
  "Tyrell Corp",
  "Oscorp",
  "Monsters Inc",
  "Vandelay Industries",
  "Bluth Company",
  "Sterling Cooper",
  "Weyland-Yutani",
  "Buy n Large",
  "Soylent Corp",
  "Virtucon",
  "Gekko & Co",
] as const;

const ROLES = [
  "Software Engineer",
  "Frontend Developer",
  "Backend Engineer",
  "Full-Stack Developer",
  "DevOps Engineer",
  "Data Analyst",
  "QA Engineer",
  "Platform Engineer",
  "Junior Developer",
  "Site Reliability Engineer",
] as const;

const ATS_SENDER_DOMAINS = [
  "greenhouse-mail.io",
  "hire.lever.co",
  "myworkday.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "icims.com",
  "teamtailor.com",
  "workablemail.com",
] as const;

// ---------------------------------------------------------------------------
// Spec model
// ---------------------------------------------------------------------------

interface SeedEvent {
  type: EventType;
  source: EventSource;
  confidence: Confidence;
  occurredAt: Date;
  senderDomain: string | null;
  /** Assign a fake unique gmailMessageId (email-source events only). */
  gmail: boolean;
}

interface SeedApp {
  company: string;
  role: string | null;
  source: EventSource;
  appliedAt: Date;
  events: SeedEvent[];
}

interface DemoUserSpec {
  slug: string;
  name: string;
  displayName: string;
  apps: SeedApp[];
  orphanEvents: SeedEvent[];
}

interface Ctx {
  rng: Rng;
  nextCompany: () => string;
}

function makeCtx(seed: number): Ctx {
  const rng = mulberry32(seed);
  const deck = shuffled(rng, COMPANIES);
  let i = 0;
  return {
    rng,
    nextCompany: () => deck[i++ % deck.length],
  };
}

function ev(
  type: EventType,
  occurredAt: Date,
  opts: Partial<Omit<SeedEvent, "type" | "occurredAt">> = {}
): SeedEvent {
  const source = opts.source ?? "email";
  return {
    type,
    occurredAt,
    source,
    confidence: opts.confidence ?? "high",
    senderDomain: opts.senderDomain ?? null,
    gmail: opts.gmail ?? source === "email",
  };
}

function baseApp(ctx: Ctx, appliedAt: Date, source: EventSource = "email"): SeedApp {
  const senderDomain = source === "email" ? pick(ctx.rng, ATS_SENDER_DOMAINS) : null;
  return {
    company: ctx.nextCompany(),
    role: pick(ctx.rng, ROLES),
    source,
    appliedAt,
    events: [ev("applied", appliedAt, { source, senderDomain })],
  };
}

const appSender = (app: SeedApp) => app.events[0].senderDomain;

// --- generic outcome builders ----------------------------------------------

/** Still waiting. Applied recently so the ghost sweeper leaves it alone. */
function pendingApp(ctx: Ctx, source: EventSource = "email"): SeedApp {
  return baseApp(ctx, daysAgo(int(ctx.rng, 2, 20)), source);
}

/** Old rejection: always ≥ ~8 days ago so it can never leak into the current
 * ISO week and muddy the king race; always ≥ 24h after applying so it never
 * grants an unplanned Speedrunner badge. */
function rejectedApp(ctx: Ctx): SeedApp {
  const appliedDays = int(ctx.rng, 20, 115);
  const app = baseApp(ctx, daysAgo(appliedDays));
  const waitDays = int(ctx.rng, 1, Math.min(40, appliedDays - 9));
  const rejectedAt = new Date(
    app.appliedAt.getTime() + waitDays * DAY_MS + int(ctx.rng, 1, 18) * HOUR_MS
  );
  app.events.push(
    ev("rejected", rejectedAt, {
      senderDomain: appSender(app),
      confidence: ctx.rng() < 0.2 ? "medium" : "high",
    })
  );
  return app;
}

/** Ghosted via a ~30-day-old system event (the sweeper's work). */
function ghostedApp(ctx: Ctx, seq: number): SeedApp {
  const app = baseApp(ctx, daysAgo(int(ctx.rng, 61, 110)));
  app.events.push(
    ev("ghosted", new Date(daysAgo(30).getTime() + seq * 7 * MINUTE_MS), {
      source: "system",
      gmail: false,
    })
  );
  return app;
}

/** Ghost event landing inside the current ISO week (weekly-ghosted board). */
function currentWeekGhostApp(ctx: Ctx, fraction: number): SeedApp {
  const app = baseApp(ctx, daysAgo(int(ctx.rng, 45, 50)));
  app.events.push(ev("ghosted", inCurrentWeek(fraction), { source: "system", gmail: false }));
  return app;
}

function interviewApp(ctx: Ctx, source: EventSource = "email"): SeedApp {
  const appliedDays = int(ctx.rng, 15, 60);
  const app = baseApp(ctx, daysAgo(appliedDays), source);
  const waitDays = int(ctx.rng, 3, Math.min(10, appliedDays - 9));
  app.events.push(
    ev(
      "interview",
      new Date(app.appliedAt.getTime() + waitDays * DAY_MS + int(ctx.rng, 1, 12) * HOUR_MS),
      { source, senderDomain: source === "email" ? appSender(app) : null }
    )
  );
  return app;
}

/** Applied → rejected after exactly `minutes` (speedrun material). */
function fastRejectionApp(ctx: Ctx, appliedDaysAgo: number, minutes: number): SeedApp {
  const app = baseApp(ctx, daysAgo(appliedDaysAgo));
  app.events.push(
    ev("rejected", new Date(app.appliedAt.getTime() + minutes * MINUTE_MS), {
      senderDomain: appSender(app),
    })
  );
  return app;
}

/** Rejection landing inside the current ISO week (king race). */
function currentWeekRejectionApp(ctx: Ctx, appliedDaysAgo: number, fraction: number): SeedApp {
  const app = baseApp(ctx, daysAgo(appliedDaysAgo));
  app.events.push(
    ev("rejected", inCurrentWeek(fraction), { senderDomain: appSender(app) })
  );
  return app;
}

/** One rejection exactly `weeksBack` ISO weeks before the current one —
 * subtracting exact multiples of 7 days from a mid-current-week anchor keeps
 * each rejection in its own consecutive ISO week (Iron Streak material). */
function streakRejectionApp(ctx: Ctx, weeksBack: number): SeedApp {
  const rejectedAt = new Date(inCurrentWeek(0.5).getTime() - weeksBack * 7 * DAY_MS);
  const app = baseApp(ctx, new Date(rejectedAt.getTime() - (12 + weeksBack) * DAY_MS));
  app.events.push(ev("rejected", rejectedAt, { senderDomain: appSender(app) }));
  return app;
}

// ---------------------------------------------------------------------------
// The six demo degenerates
// ---------------------------------------------------------------------------

/** 60 apps, 46 rejections (one orphan), Iron Streak, serial applicant. */
function buildSirRejectsALot(): DemoUserSpec {
  const ctx = makeCtx(101);
  const apps: SeedApp[] = [];
  apps.push(currentWeekRejectionApp(ctx, 15, 0.35));
  apps.push(currentWeekRejectionApp(ctx, 18, 0.55));
  for (let k = 0; k < 6; k++) apps.push(streakRejectionApp(ctx, k)); // 6-week streak
  apps.push(fastRejectionApp(ctx, 30, 6 * 60)); // 6h speedrun entry
  for (let i = 0; i < 36; i++) apps.push(rejectedApp(ctx));
  for (let i = 0; i < 6; i++) apps.push(ghostedApp(ctx, i));
  apps.push(interviewApp(ctx));
  for (let i = 0; i < 8; i++) apps.push(pendingApp(ctx));
  return {
    slug: "sir-rejects-a-lot",
    name: "Sir Rejects-a-Lot",
    displayName: "Sir Rejects-a-Lot",
    apps,
    // One unlinked rejection (applicationId null) — profile still counts it.
    orphanEvents: [ev("rejected", daysAgo(12), { senderDomain: "hire.lever.co" })],
  };
}

/** 40 apps, 17 ghostings (Ghost Whisperer), 3 of them this week. */
function buildGhostMagnet(): DemoUserSpec {
  const ctx = makeCtx(202);
  const apps: SeedApp[] = [];
  for (let i = 0; i < 14; i++) apps.push(ghostedApp(ctx, i));
  apps.push(currentWeekGhostApp(ctx, 0.22));
  apps.push(currentWeekGhostApp(ctx, 0.48));
  apps.push(currentWeekGhostApp(ctx, 0.74));
  apps.push(fastRejectionApp(ctx, 40, 72 * 60)); // 72h — slow "speedrun"
  for (let i = 0; i < 6; i++) apps.push(rejectedApp(ctx));
  for (let i = 0; i < 16; i++) apps.push(pendingApp(ctx));
  return {
    slug: "ghost-magnet",
    name: "Ghost Magnet",
    displayName: "Ghost Magnet",
    apps,
    orphanEvents: [],
  };
}

/** 25 apps, four sub-hour rejections — Any% World Record holder. */
function buildSpeedrunSam(): DemoUserSpec {
  const ctx = makeCtx(303);
  const apps: SeedApp[] = [];
  apps.push(fastRejectionApp(ctx, 9, 12)); // 12 minutes. A record.
  apps.push(fastRejectionApp(ctx, 10, 27));
  apps.push(fastRejectionApp(ctx, 12, 38));
  apps.push(fastRejectionApp(ctx, 14, 51));
  for (let i = 0; i < 8; i++) apps.push(rejectedApp(ctx));
  apps.push(interviewApp(ctx));
  for (let i = 0; i < 3; i++) apps.push(ghostedApp(ctx, i));
  for (let i = 0; i < 9; i++) apps.push(pendingApp(ctx));
  return {
    slug: "speedrun-sam",
    name: "Speedrun Sam",
    displayName: "Speedrun Sam",
    apps,
    orphanEvents: [],
  };
}

/** 15 manually-tracked apps, interviews, ONE OFFER (The Chosen One). */
function buildTheOptimist(): DemoUserSpec {
  const ctx = makeCtx(404);
  const apps: SeedApp[] = [];

  const offerApp = baseApp(ctx, daysAgo(40), "manual");
  offerApp.events.push(
    ev("interview", daysAgo(28), { source: "manual", gmail: false }),
    ev("interview", daysAgo(18), { source: "manual", gmail: false }),
    ev("offer", daysAgo(9), { source: "manual", gmail: false })
  );
  apps.push(offerApp);

  for (let i = 0; i < 3; i++) apps.push(interviewApp(ctx, "manual"));

  const rejectedOnce = baseApp(ctx, daysAgo(35), "manual");
  rejectedOnce.events.push(
    ev("rejected", daysAgo(20), { source: "manual", gmail: false })
  );
  apps.push(rejectedOnce);

  for (let i = 0; i < 10; i++) apps.push(pendingApp(ctx, "manual"));
  return {
    slug: "the-optimist",
    name: "The Optimist",
    displayName: "The Optimist",
    apps,
    orphanEvents: [],
  };
}

/** 50 apps, 30 rejections, TEN of them this week — the clear current king. */
function buildQueenOfNothing(): DemoUserSpec {
  const ctx = makeCtx(505);
  const apps: SeedApp[] = [];
  for (let i = 0; i < 10; i++) {
    apps.push(currentWeekRejectionApp(ctx, 10 + i, (i + 1) / 11));
  }
  apps.push(fastRejectionApp(ctx, 25, 52)); // 52 min — second sub-hour speedrunner
  for (let i = 0; i < 19; i++) apps.push(rejectedApp(ctx));
  for (let i = 0; i < 5; i++) apps.push(ghostedApp(ctx, i));
  for (let i = 0; i < 2; i++) apps.push(interviewApp(ctx));
  for (let i = 0; i < 13; i++) apps.push(pendingApp(ctx));
  return {
    slug: "queen-of-nothing",
    name: "Queen of Nothing",
    displayName: "Queen of Nothing",
    apps,
    orphanEvents: [],
  };
}

/** 20 apps, incl. THE necromancer case: ghosted 35d ago, rejected 20d ago. */
function buildNecroNancy(): DemoUserSpec {
  const ctx = makeCtx(606);
  const apps: SeedApp[] = [];

  const necro = baseApp(ctx, daysAgo(70));
  necro.events.push(
    ev("ghosted", daysAgo(35), { source: "system", gmail: false }),
    ev("rejected", daysAgo(20), { senderDomain: appSender(necro) }) // back from the dead
  );
  apps.push(necro);

  apps.push(fastRejectionApp(ctx, 33, 30 * 60)); // 30h pair
  for (let i = 0; i < 6; i++) apps.push(rejectedApp(ctx));
  for (let i = 0; i < 4; i++) apps.push(ghostedApp(ctx, i));
  apps.push(currentWeekGhostApp(ctx, 0.62));
  apps.push(interviewApp(ctx));
  for (let i = 0; i < 6; i++) apps.push(pendingApp(ctx));
  return {
    slug: "necro-nancy",
    name: "Necro Nancy",
    displayName: "Necro Nancy",
    apps,
    orphanEvents: [],
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface SummaryRow {
  slug: string;
  apps: number;
  rejected: number;
  ghosted: number;
  interviews: number;
  offers: number;
  "rejected (this week)": number;
  "ghosted (this week)": number;
}

function summarize(spec: DemoUserSpec): SummaryRow {
  const all = [...spec.apps.flatMap((a) => a.events), ...spec.orphanEvents];
  const weekEndMs = weekStartMs + 7 * DAY_MS;
  const count = (type: EventType) => all.filter((e) => e.type === type).length;
  const weekly = (type: EventType) =>
    all.filter((e) => {
      const t = e.occurredAt.getTime();
      return e.type === type && t >= weekStartMs && t < weekEndMs;
    }).length;
  return {
    slug: spec.slug,
    apps: spec.apps.length,
    rejected: count("rejected"),
    ghosted: count("ghosted"),
    interviews: count("interview"),
    offers: count("offer"),
    "rejected (this week)": weekly("rejected"),
    "ghosted (this week)": weekly("ghosted"),
  };
}

async function createDemoUser(spec: DemoUserSpec): Promise<void> {
  const user = await db.user.create({
    data: {
      email: `${spec.slug}${DEMO_EMAIL_SUFFIX}`,
      slug: spec.slug,
      name: spec.name,
      displayName: spec.displayName,
      publicProfile: true,
      leaderboardOptIn: true,
      ghostAfterDays: 30,
    },
  });

  let messageSeq = 0;
  const nextMessageId = () => `demo-msg-${spec.slug}-${++messageSeq}`;

  for (const app of spec.apps) {
    await db.application.create({
      data: {
        userId: user.id,
        company: app.company,
        companyNormalized: app.company.trim().toLowerCase(),
        role: app.role,
        source: app.source,
        appliedAt: app.appliedAt,
        events: {
          create: app.events.map((e) => ({
            userId: user.id,
            type: e.type,
            source: e.source,
            confidence: e.confidence,
            occurredAt: e.occurredAt,
            senderDomain: e.senderDomain,
            gmailMessageId: e.gmail ? nextMessageId() : null,
          })),
        },
      },
    });
  }

  for (const e of spec.orphanEvents) {
    await db.event.create({
      data: {
        userId: user.id,
        applicationId: null,
        type: e.type,
        source: e.source,
        confidence: e.confidence,
        occurredAt: e.occurredAt,
        senderDomain: e.senderDomain,
        gmailMessageId: e.gmail ? nextMessageId() : null,
      },
    });
  }
}

async function main(): Promise<void> {
  console.log("👑 Seeding UnemployedKing demo data...");
  console.log(`   Anchor: ${now.toISOString()} (ISO week starts ${new Date(weekStartMs).toISOString()})`);

  const removed = await db.user.deleteMany({
    where: { email: { endsWith: DEMO_EMAIL_SUFFIX } },
  });
  if (removed.count > 0) {
    console.log(`   Removed ${removed.count} existing demo users (cascade cleared their data).`);
  }

  const specs = [
    buildSirRejectsALot(),
    buildGhostMagnet(),
    buildSpeedrunSam(),
    buildTheOptimist(),
    buildQueenOfNothing(),
    buildNecroNancy(),
  ];

  for (const spec of specs) {
    await createDemoUser(spec);
    console.log(`   ✓ ${spec.slug} (${spec.apps.length} applications)`);
  }

  console.table(specs.map(summarize));
  console.log("Expected weekly king: queen-of-nothing 👑 (10 rejections this week)");
  console.log("Expected speedrun leader: speedrun-sam ⚡ (0.2h), sub-hour runner-up: queen-of-nothing (0.87h)");
  console.log("Necromancer case 🧟: necro-nancy. The one offer 🏆: the-optimist.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
