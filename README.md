# UnemployedKing 👑

**Get rejected. Get ranked.**

UnemployedKing is a job-hunt tracker for people who have stopped pretending. It connects to your Gmail (read-only, we're unemployed, not evil), detects application confirmations, rejections, interview invites, and offers straight from the ATS emails already haunting your inbox, derives ghostings for the companies too cowardly to send one, and turns the whole mess into a public profile with levels, badges, and competitive leaderboards. Every week, the user with the most rejections is crowned **Unemployed King 👑**. Rejections aren't failure here. They're proof you actually showed up. The job market is a competitive ladder. Literally.

## Quickstart (dev mode, zero OAuth required)

```bash
npm install
cp .env.example .env        # then edit .env, see below
npx prisma migrate dev      # creates the SQLite dev.db
npm run seed                # 6 demo degenerates with realistic misery
npm run dev
```

Minimum `.env` for local dev:

- `AUTH_SECRET`: any base64 secret (`openssl rand -base64 32`)
- `DEV_LOGIN="true"`: enables the username-only dev login (no Google needed)

Then:

1. Open [http://localhost:3000](http://localhost:3000)
2. Go to `/login` and use the dev login with any username (e.g. `me`)
3. Browse a seeded profile: [http://localhost:3000/u/sir-rejects-a-lot](http://localhost:3000/u/sir-rejects-a-lot)
   (also try `ghost-magnet`, `speedrun-sam`, `the-optimist`, `queen-of-nothing`, `necro-nancy`)
4. Check `/leaderboard` to see who wears the crown this week

No Google credentials, no Gemini key required. Everything degrades gracefully. You just won't have Gmail sync or LLM classification until you add them.

## Google OAuth setup (real Gmail sync)

This is the longest part of setup because Google makes you earn it. Budget 15 minutes.

1. **Create a project** at [console.cloud.google.com](https://console.cloud.google.com) (or reuse one).
2. **Enable the Gmail API**: *APIs & Services → Library → Gmail API → Enable*.
3. **Configure the OAuth consent screen**: *APIs & Services → OAuth consent screen*.
   - User type: **External**.
   - Publishing status: leave it in **Testing** mode. Do not publish.
   - Scopes: add `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/gmail.readonly`.
   - **Test users**: add your own Gmail address (and any friends you want to drag into this). Only listed test users can log in while in Testing mode.
4. **Create credentials**: *APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application*.
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   - Copy the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`.
5. **Know the Testing-mode caveats** (Google's, not ours):
   - Hard cap of **100 test users** per project.
   - **Refresh tokens expire after 7 days** in Testing mode. When yours dies, log in with Google again and re-consent. The app stores the new token and carries on. Annoying, but free.
   - Going to production with the `gmail.readonly` scope requires Google's **CASA security assessment** (a paid third-party audit). That's a future-us problem; Testing mode is fine for personal use and demos.

Once configured, the login page shows a Google button. After login, hit **Sync now** on the dashboard to backfill the last ~180 days of ATS email.

## Gemini API key (smarter classification)

The classifier is layered: deterministic rules first, LLM second. The rules catch the boilerplate ("we've decided to move forward with other candidates", we know, Greenhouse, we know). For the weird ones, Gemini (`gemini-2.5-flash-lite`) reads the email and decides.

1. Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Put it in `GEMINI_API_KEY` in `.env`.

Without a key, classification is rules-only. It still catches the vast majority of ATS mail, just misses the creatively worded rejections.

## Environment variables

Copy `.env.example` to `.env`. Full reference:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | `file:./dev.db` for SQLite dev; a `postgresql://…` URL after the Postgres switch |
| `AUTH_SECRET` | yes | NextAuth JWT signing secret (`openssl rand -base64 32`) |
| `AUTH_TRUST_HOST` | yes | Keep `"true"` for local/self-hosted deployments |
| `GOOGLE_CLIENT_ID` | no | Google OAuth client ID; omit to hide Google login entirely |
| `GOOGLE_CLIENT_SECRET` | no | Google OAuth client secret |
| `GEMINI_API_KEY` | no | Enables Layer-2 LLM classification; omit for rules-only |
| `TOKEN_ENCRYPTION_KEY` | yes* | AES-256-GCM key (base64, 32 bytes) for refresh tokens at rest. *Required if Google login is configured |
| `CRON_SECRET` | yes* | Shared secret for the cron endpoints (`/api/cron/ghost-sweep`, `/api/cron/auto-sync`). *Required if you run either |
| `DEV_LOGIN` | no | `"true"` enables the username-only dev login. **Never `"true"` in production** |
| `NEXT_PUBLIC_APP_URL` | yes | Base URL, `http://localhost:3000` in dev; used for share links and OG images |

## Architecture

```
Gmail (read-only) ──► sync ──► 3-layer classifier ──► append-only Event log ──► derived status
                                                                             └─► stats / badges / leaderboards
```

**Three-layer classifier** (`lib/classifier/`):

1. **Rules**: deterministic phrase + sender-domain matching against known ATS domains (Greenhouse, Lever, Workday, Ashby, and friends). No network. Catches most boilerplate and immediately discards job-alert spam, "your application was viewed" dopamine bait, and newsletters.
2. **LLM**: anything ambiguous from an ATS sender goes to `gemini-2.5-flash-lite` with a structured-output schema. Strict prompt: a rejection must be a decision about *this applicant's specific application*, not a generic "position filled" blast.
3. **Fail-safe null**: no key, API error, or genuinely unclassifiable? Nothing is recorded. The sync loop never fails loud on a single message.

**Append-only events, derived status.** `Event` rows are never updated or deleted. An application's status is always computed from its event history: latest event wins, except a `ghosted` event is overridden by anything that arrives after it (the Necromancer case 🧟: rejected from beyond the grave still counts as rejected). Manual entries are protected: the email pipeline never auto-attaches medium/low-confidence events to an application you touched by hand.

**Ghost sweeper.** A cron endpoint (`GET /api/cron/ghost-sweep?secret=…`) marks applications as `ghosted` after `ghostAfterDays` (default 30) of radio silence. Source `system`, one event per app, idempotent.

**Auto-sync.** From the dashboard you can set a recurring sync cadence (every day, every 7 days, or a custom 1–90 days, capped server-side). A second cron endpoint (`GET /api/cron/auto-sync?secret=…`) syncs every user whose interval has elapsed since their last sync. Leave it on "Manual only" and nothing runs until you press **Sync now**.

**Privacy: Gmail is the database of record.** We never store email bodies or subjects, only Gmail message/thread IDs, the sender domain, and the extracted facts (company, role, event type). Refresh tokens are AES-256-GCM encrypted at rest. Delete your account and everything cascades. Your rejections live in your inbox; we just keep score.

## Switching to Postgres

The schema is Postgres-portable by design (no SQLite-only features). When SQLite stops being enough:

1. Start Postgres:

   ```bash
   docker compose -f docker-compose.postgres.yml up -d
   ```

2. In `prisma/schema.prisma`, change the datasource provider from `"sqlite"` to `"postgresql"`.
3. In `.env`, set:

   ```
   DATABASE_URL="postgresql://unemployedking:unemployedking@localhost:5432/unemployedking"
   ```

4. Reset migrations for the new provider (SQLite migration history doesn't transfer):

   ```bash
   npx prisma migrate dev
   npm run seed
   ```

## Deploy notes

- Runs anywhere Node runs (Vercel, a VPS, that Raspberry Pi in your drawer). `npm run build && npm run start`.
- Use Postgres in production; SQLite is for dev.
- Set every required env var; set `NEXT_PUBLIC_APP_URL` to your real origin and add `https://your-domain/api/auth/callback/google` as an authorized redirect URI in Google Cloud.
- Schedule `GET /api/cron/ghost-sweep` daily (Vercel Cron, GitHub Actions, or plain crontab) with `Authorization: Bearer $CRON_SECRET` or `?secret=`.
- Schedule `GET /api/cron/auto-sync` at least daily (same auth) so users' chosen sync cadences actually fire. Each run only touches accounts whose interval has elapsed, so running it more often than the shortest cadence is harmless.
- `DEV_LOGIN` must be `"false"` in production, unless you want strangers logging in as `sir-rejects-a-lot`.
- Gmail sync in production means leaving Google's Testing mode, which means CASA (see above). Until then: 100 test users max. An exclusive club of the unemployed.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server on :3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run seed` | Reset + reseed demo users (deterministic; safe to re-run) |
| `npm run classifier:check` | Run the rules-layer fixture suite (exits 1 on regression) |
| `npx prisma migrate dev` | Create/apply migrations |
| `npx prisma studio` | Poke at the database with a GUI |

## Roadmap (a.k.a. cope)

- **Browser extension**: one-click "I applied" capture from any job board, so even non-email applications feed the ladder.
- **Seasons**: quarterly resets with placement badges. Your Q3 rejection rank is forever.
- **Friend leagues**: private leaderboards, because misery loves a lobby.

Until then: apply, get rejected, climb. Long live the King. 👑

## License

[MIT](LICENSE). Fork it, self-host it, get rejected on your own terms.
