# UnemployedKing 👑 Design Contract

**Read this whole file before writing any code.** It is the single source of truth
for module boundaries, exported signatures, data rules, and UI tokens. If your
implementation needs to deviate, deviate minimally and note it in your report.

## 1. Product

A darkly funny job-hunt tracker. Users connect Gmail (read-only); we detect
applications, rejections, interviews, and offers from ATS emails, derive ghostings,
and turn the misery into public shareable profiles, badges, and competitive
leaderboards. The weekly #1 most-rejected user is crowned **Unemployed King 👑**.

Tone: self-deprecating gamer humor (League-of-Legends mastery-page energy).
Never mean-spirited toward users; the joke is the market, not the person.
Rejections are framed as **proof of effort**. Celebrating them is the point.

## 2. Stack & conventions

- Next.js 15 App Router, TypeScript strict, React Server Components by default.
  `"use client"` only where interactivity demands it.
- Tailwind CSS v4 (via `@import "tailwindcss"` in `app/globals.css`). No UI kit,
  no chart library, no extra npm deps beyond what's already in package.json
  (`next-auth@beta`, `@prisma/client@6`, `@google/genai`, `zod`, dev: `prisma@6`, `tsx`).
- Prisma 6 + SQLite in dev (`lib/db.ts` exports `db`). Schema is Postgres-portable, so
  don't use SQLite-only or Postgres-only features. **No raw SQL**; Prisma queries only.
- Domain types come from `lib/types.ts`: import, never redefine.
- All dates stored/compared in UTC. "Week" = ISO week starting Monday 00:00 UTC.
- Errors: never swallow silently; return typed results or throw with useful messages.
- Windows dev machine: no shell-specific assumptions in npm scripts.

## 3. Data rules (critical invariants)

1. **Events are append-only.** Nothing updates or deletes Event rows (except user
   deleting their account, cascade).
2. **Status is derived, never stored.** `deriveStatus(events)`:
   - Sort events by `occurredAt` ascending; status = type of the LAST event,
     with one exception: a `ghosted` event is overridden by ANY event that occurs
     after it (a later `rejected` after `ghosted` → status `rejected`, that's the
     Necromancer case 🧟).
   - No events → `applied` (shouldn't happen; every application gets an `applied` event).
3. **The pipeline never overwrites human intent.** If an application has any
   `source: "manual"` event, incoming `email` events for it with confidence
   `medium`/`low` must NOT auto-attach. Create them unattached (applicationId
   null) for future review. `high` confidence email events may attach.
4. **Privacy: never store email bodies/subjects.** Only `gmailMessageId`,
   `gmailThreadId`, `senderDomain`, and extracted fields (company, role, type).
5. **Idempotency:** `Event.gmailMessageId` is unique. Check before insert;
   re-syncing the same messages must be a no-op.
6. **Ghost sweeper (source=system):** for each application whose derived status is
   `applied` or `interview`, with no `ghosted` event, and `appliedAt <
   now - user.ghostAfterDays`: insert one `ghosted` event (occurredAt = now).

## 4. Module map & exported contracts

### 4.1 `lib/crypto.ts` (owner: auth agent)
AES-256-GCM using `TOKEN_ENCRYPTION_KEY` (base64 32 bytes) via node:crypto.
```ts
export function encryptSecret(plain: string): string; // format: iv.ciphertext.tag (base64 parts)
export function decryptSecret(payload: string): string;
```

### 4.2 `auth.ts` (repo root) + `app/api/auth/[...nextauth]/route.ts` + `lib/slug.ts` + `middleware.ts` + `app/login/page.tsx` (owner: auth agent)
NextAuth v5, **JWT session strategy, NO database adapter** (privacy: we manage our
own User rows; Google tokens never persist in plaintext).

- Google provider (only when GOOGLE_CLIENT_ID set): scopes
  `openid email profile https://www.googleapis.com/auth/gmail.readonly`,
  authorization params `access_type=offline`, `prompt=consent`.
- Dev Credentials provider "dev" (only when `process.env.DEV_LOGIN === "true"`):
  single field `username`; find-or-create User with slug=username,
  email=`${username}@dev.local`.
- `signIn` callback: upsert User (email); generate unique slug from email
  local-part via `lib/slug.ts` (`makeUniqueSlug(base: string): Promise<string>`);
  if Google account has `refresh_token`, upsert EmailAccount with
  `encryptedRefreshToken = encryptSecret(refresh_token)`.
- `jwt`/`session` callbacks: `session.user` carries `{ id, slug, email, name }`.
  Export `auth`, `signIn`, `signOut`, `handlers` from `auth.ts`.
- Type augmentation for `session.user.id/slug` in `types/next-auth.d.ts`.
- `middleware.ts`: redirect unauthenticated `/dashboard` → `/login`.
- `/login`: dark page, crown branding; Google button (if configured) + dev-login
  form (if DEV_LOGIN) posting to a server action that calls `signIn("dev", ...)`.

### 4.3 `lib/classifier/` (owner: classifier agent)
Files: `strip.ts`, `rules.ts`, `llm.ts`, `index.ts`, plus `scripts/classifier-check.ts`.

```ts
// index.ts orchestrator: rules first; if null and GEMINI_API_KEY set, LLM; else null
export async function classifyEmail(input: EmailInput): Promise<ClassifiedEmail | null>;
// rules.ts: deterministic Layer 1 (no network). Exported for tests.
export function classifyByRules(input: EmailInput): ClassifiedEmail | null;
export const ATS_DOMAINS: string[]; // greenhouse-mail.io, greenhouse.io, hire.lever.co, lever.co, myworkday.com, ashbyhq.com, smartrecruiters.com, icims.com, comeet.co, bamboohr.com, teamtailor.com, workablemail.com, workable.com, jobvite.com, recruitee.com, breezy.hr, taleo.net
// strip.ts
export function htmlToText(html: string): string; // strip tags, decode entities, collapse whitespace
```

Rules (Layer 1), case-insensitive matching on subject+body:
- REJECTION phrases (→ `rejection`, confidence high when sender is ATS, medium otherwise):
  "decided to move forward with other candidates", "will not be moving forward",
  "decided to pursue other candidates", "we regret to inform you",
  "your application was not selected", "decided to go in a different direction",
  "unfortunately" + ("your application" | "your candidacy"),
  "chosen to proceed with other applicants", "position has been filled".
- APPLIED confirmation (→ `applied_confirmation`, high when ATS):
  "thank you for applying", "we('ve| have) received your application",
  "your application (was|has been) (received|submitted)", "application confirmation".
- INTERVIEW (→ `interview_invite`, high when ATS): "schedule (a|your) (call|interview)",
  "invite you to interview", "would love to (chat|speak|meet)" + ATS sender only,
  "interview invitation", "book a time".
- OFFER (→ `offer`, always medium from rules, offers deserve human confirmation):
  "pleased to offer you", "offer letter", "extend (you )?an offer".
- NEVER-signals (→ return `{event:"other"}` immediately, before other checks):
  sender domains/patterns of job boards & alerts: linkedin.com (jobs-noreply,
  jobalerts), indeed.com alerts, glassdoor.com, "job alert", "jobs for you",
  "new jobs matching", "application viewed", "profile view", newsletters
  (`list-unsubscribe`-style marketing wording alone is NOT enough; use sender+subject).
- Company extraction (rules layer): from subject patterns like
  "Your application to X", "Thank you for applying to X", "Update on your
  application at X"; else from ATS sender display name; else null.
- If nothing matches and sender IS an ATS domain → return null (→ LLM decides).
  If nothing matches and sender is NOT ATS and subject lacks application keywords →
  `{event:"other", confidence:"low"}` (don't waste LLM calls on random mail).

LLM (Layer 2, `llm.ts`): Google Gen AI SDK, model **`gemini-2.5-flash-lite`**, maxOutputTokens 512,
structured output via `responseMimeType: "application/json"` + a `responseSchema`
on `ai.models.generateContent`, then re-validated with a zod schema that mirrors
`ClassifiedEmail` (event enum, company/role nullable, confidence enum). Prompt must state: job-alert digests,
"application viewed" notices, recruiter cold outreach, and generic position-closed
announcements are `other`; a rejection must be a decision about THIS applicant's
specific application. Truncate bodyText to ~4000 chars. On API error or missing
key: return null (caller records nothing, fail safe, never fail loud in sync loop).

`scripts/classifier-check.ts`: ~15 hardcoded fixture emails (rejections incl. one
Hebrew "לצערנו החלטנו להתקדם עם מועמדים אחרים", confirmations, interview invite,
LinkedIn job alert, "application viewed", newsletter) asserting `classifyByRules`
output; exits 1 with a diff on failure, prints PASS summary otherwise. No test
framework. Plain tsx script, `npm run classifier:check`.

### 4.4 `lib/gmail/` + sync/cron routes (owner: gmail agent)
Files: `lib/gmail/client.ts`, `lib/gmail/sync.ts`, `lib/gmail/linker.ts`,
`lib/ghost.ts`, `app/api/sync/route.ts`, `app/api/cron/ghost-sweep/route.ts`.

`client.ts`, raw REST via fetch (no googleapis dep):
```ts
export async function getAccessToken(acct: { encryptedRefreshToken: string | null }): Promise<string>; // POST oauth2.googleapis.com/token, grant_type=refresh_token
export async function listMessageIds(token: string, q: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>;
export async function getMessage(token: string, id: string): Promise<GmailMessage>; // format=full
export function extractEmailInput(msg: GmailMessage): EmailInput & { messageId: string; threadId: string; senderDomain: string };
export async function listHistory(token: string, startHistoryId: string): Promise<{ messageIds: string[]; newHistoryId: string | null; expired: boolean }>; // expired=true on HTTP 404
```
Body extraction: walk payload parts recursively; prefer `text/plain`, fall back to
`htmlToText(text/html)`; base64url decode. Sender domain = domain of the From
address. Handle 401 by refreshing token once; 429/5xx: small retry (2 attempts).

`sync.ts`:
```ts
export const BACKFILL_QUERY: string; // from:(ATS domains) OR subject:("your application" OR "thank you for applying" OR "application update" ...) newer_than:180d, build from ATS_DOMAINS
export async function runBackfill(userId: string): Promise<SyncResult>;
export async function runIncrementalSync(userId: string): Promise<SyncResult>; // history.list from stored historyId; on expired cursor fall back to BACKFILL_QUERY with newer_than window since lastSyncedAt; store new historyId + lastSyncedAt
```
Per message: skip if `Event.gmailMessageId` exists → `classifyEmail` → map
`applied_confirmation→applied`, `rejection→rejected`, `interview_invite→interview`,
`offer→offer`; `other`/null → skipped++. Then `linker.ts`:
```ts
export async function linkAndPersist(userId: string, cls: ClassifiedEmail, meta: { messageId: string; threadId: string; senderDomain: string; receivedAt: Date }): Promise<{ createdApplication: boolean; createdEvent: boolean }>;
```
Linking order: (1) Application with same `gmailThreadId`; (2) `applied_confirmation`
with no thread match → create Application (company from cls or senderDomain-derived,
appliedAt=receivedAt) + `applied` event; (3) non-applied events: fuzzy company match:
normalized equality or one contains the other, against user's applications, prefer
ones without terminal status; single match → attach; multiple/none → create event
with `applicationId` null (orphan; profile counts it, dashboard shows "unlinked").
Respect Data rule 3 (manual-intent protection).

`lib/ghost.ts`: `export async function runGhostSweep(): Promise<{ usersProcessed: number; ghostsCreated: number }>` per Data rule 6.

Routes: `POST /api/sync`: `auth()` required; runs backfill if `!backfillDone`
else incremental; returns SyncResult JSON; 401 otherwise. No Gmail account
connected → 400 with friendly message. `GET /api/cron/ghost-sweep`: requires
`?secret=` or `Authorization: Bearer` matching CRON_SECRET; runs sweep; JSON result.

### 4.5 `lib/stats/` + `prisma/seed.ts` (owner: stats agent)
Files: `lib/stats/status.ts`, `profile.ts`, `leaderboard.ts`, `levels.ts`,
`badges.ts`, `copy.ts`, `prisma/seed.ts`.

```ts
// status.ts
export function deriveStatus(events: { type: string; occurredAt: Date }[]): ApplicationStatus; // Data rule 2
// profile.ts
export async function getProfileStats(userId: string): Promise<ProfileStats>;
export async function getApplicationsWithStatus(userId: string): Promise<ApplicationWithStatus[]>;
export async function getUserBySlug(slug: string): Promise<{ id: string; slug: string; displayName: string; createdAt: Date } | null>; // displayName falls back to slug; respect publicProfile=false → treat as not found for public page
// leaderboard.ts
export async function getLeaderboards(): Promise<Leaderboards>; // only leaderboardOptIn users; weekly = events occurredAt within current ISO week (Mon 00:00 UTC); speedrun = min(rejected.occurredAt - applied.occurredAt) per user in hours, ascending, only pairs on same application; top 10 per board; king = weeklyRejected[0]
// levels.ts
export function rejectionLevel(rejections: number): { level: number; title: string };
// level = floor(sqrt(rejections)); titles: 0 "The Optimist", 1-2 "Fresh Meat", 3-4 "Seasoned Reject", 5-6 "Veteran of the Void", 7-9 "Rejection Royalty", 10+ "Beyond Employment"
// badges.ts
export function computeBadges(input: { stats about events }): Badge[];
// copy.ts
export function funnyTagline(stats: ProfileStats): string; // rotating deterministic one-liner based on stats
```

Badges (id, name, emoji, criteria):
- `first-blood` 🩸 First Blood: ≥1 rejection
- `ghost-whisperer` 👻 Ghost Whisperer: ≥10 ghosted (desc mentions tier counts)
- `speedrunner` ⚡ Speedrunner: a rejection ≤24h after applying
- `any-percent` 🏁 Any% World Record: a rejection ≤1h after applying
- `necromancer` 🧟 Necromancer: a rejection that arrived after a ghosted event
- `serial-applicant` 📮 Serial Applicant: ≥50 applications
- `iron-streak` 🛡️ Iron Streak: ≥4 consecutive weeks with ≥1 rejection
- `got-an-interview` 🎯 Wait, An Interview? ≥1 interview
- `the-chosen-one` 🏆 The Chosen One: ≥1 offer ("what are you still doing here?")

`prisma/seed.ts`: deletes existing demo data (users whose email ends `@demo.unemployedking.local`),
creates 6 demo users (slugs like `sir-rejects-a-lot`, `ghost-magnet`, `speedrun-sam`,
`the-optimist`, `queen-of-nothing`, `necro-nancy`) with 15-80 applications each at
fake companies (Initech, Hooli, Pied Piper, Dunder Mifflin, Umbrella Corp, Aperture
Science, ACME, Globex, Massive Dynamic, Wayne Enterprises, Stark Industries,
Wonka Industries…), realistic event timelines spread over the past 120 days
(applied → some rejected 1h-45d later, some ghosted via 30d-old system events, a few
interviews, one offer for `the-chosen-one` vibes, one necromancer case, ensure
speedrun entries <1h, ensure a clear weekly king: events within the CURRENT week).
Deterministic (seeded RNG or fixed data) so re-running is stable. Log a summary table.

### 4.6 UI (owner: ui agent; runs AFTER other agents; may read their code)
Files: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`,
`app/u/[slug]/page.tsx`, `app/u/[slug]/opengraph-image.tsx`,
`app/leaderboard/page.tsx`, `app/dashboard/page.tsx`, `app/dashboard/actions.ts`,
`components/*.tsx` (as needed: StatTile, FunnelBar, BadgeChip, LeaderboardTable,
CrownCard, Nav, TombstoneRow…).

**Design tokens (dark-only theme, the brand commits to dark):**
```css
:root {
  --bg: #0d0d0d;            /* page */
  --surface: #1a1a19;       /* cards */
  --border: rgba(255,255,255,0.10);
  --ink: #ffffff;
  --ink-2: #c3c2b7;
  --ink-muted: #898781;
  --grid: #2c2c2a;
  --gold: #fab219;          /* crown/brand accent, chrome only, never a data series */
  --blue: #3987e5; --aqua: #199e70; --violet: #9085e9; --red: #e66767;
  --good: #0ca30c; --critical: #d03b3b;
  /* ordinal funnel ramp (blue, light→dark, max depth #184f95) */
  --ramp-1: #86b6ef; --ramp-2: #3987e5; --ramp-3: #256abf; --ramp-4: #184f95;
}
```
Semantic event colors (ALWAYS paired with emoji/word, never color alone):
applied `--ink-2` 📨 · rejected `--red` 💀 · ghosted `--violet` 👻 ·
interview `--blue` 🎯 · offer `--good` 🏆.

Chart/stat rules (non-negotiable): system-ui font stack; `tabular-nums` on table
columns and any aligned figures; funnel = horizontal thin bars (max-height 28px,
4px rounded ends, 2px gaps) using the ordinal ramp with direct value labels in
`--ink-2` (text never wears the bar color); no chart libraries; no dual axes;
leaderboard tables: rank, name (link to profile), value right-aligned tabular;
king row highlighted with `--gold` border + 👑. Landing hero: giant crown, tagline
**"Get rejected. Get ranked."**, sub "The job market is a competitive ladder.
Literally." CTA → /login, secondary → /leaderboard. Show 3 teaser stats from
`getLeaderboards()`.

Profile `/u/[slug]`: 404-style fun page if unknown/private. Header: displayName,
`Lv.{level} {title}`, 👑 if current king (compare slug with `getLeaderboards().king`).
KPI row of StatTiles (Applied / Rejected / Ghosted / Interviews / Offers). Funnel.
Time-stats row (fastest rejection ⚡, avg days to rejection, longest ghost 👻).
Badges grid (earned only). Tombstone list: last 8 terminal applications as
`🪦 {Company} · {status} after {n} days`. Footer: share hint + funnyTagline.
`opengraph-image.tsx`: 1200×630 ImageResponse, dark bg, crown, displayName,
"Lv.X" + 3 big stats, site name.

Dashboard (auth-required): Gmail connect status card (connected address or
"Connect Gmail" → /login note; if no Google env configured, show setup hint),
"Sync now" button POSTing /api/sync (client component, shows SyncResult),
manual-add form (company, role, date, status dropdown) via server action in
`actions.ts` (creates Application + applied event + optional terminal event,
source=manual), applications table (company, role, applied date, status chip,
days), personal stats strip, link to public profile + copy-URL button.

Server components fetch via lib/stats directly; only interactive bits are client.
Empty states everywhere must be funny ("No rejections yet. Aim higher.").

### 4.7 Docs (owner: docs agent)
`README.md`: what it is (one funny paragraph), quickstart (npm install → npx prisma
migrate dev → npm run seed → npm run dev → login via dev mode → see profile),
Google OAuth setup walkthrough (Cloud Console, Gmail API, consent screen Testing
mode, redirect URI, 100-user/7-day caveats), GEMINI_API_KEY setup, env table,
architecture sketch (3-layer classifier, privacy: no bodies stored), Postgres
switch guide, deploy notes, scripts table. `docker-compose.postgres.yml` (postgres:16,
volume, port 5432) for the future switch. Keep honest + funny.

## 5. package.json scripts (integration agent ensures)
```json
"seed": "tsx prisma/seed.ts",
"classifier:check": "tsx scripts/classifier-check.ts",
"prisma": { "seed": "tsx prisma/seed.ts" }  // top-level key, sibling of scripts
```

## 6. Env vars
See `.env.example`. Code must degrade gracefully: no GOOGLE_* → Google login/sync
hidden with hint; no GEMINI_API_KEY → rules-only classification; DEV_LOGIN
gates the credentials provider.
