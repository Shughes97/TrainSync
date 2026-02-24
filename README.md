# TrainSync

A personal training companion that connects your CrossFit gym (Wodify), Strava, and Google Calendar into a single mobile-first dashboard.

- Proposes a balanced weekly training plan and pushes it to Google Calendar
- Parses Wodify screenshots with Claude AI to log WOD details
- Enriches sessions with Strava HR and effort data
- Computes a daily readiness score based on your recent training load

---

## Features

- **Google OAuth** — Calendar read/write access
- **Strava integration** — syncs activities, matches them to gym sessions by date and sport type
- **Wodify screenshot parsing** — upload 1–3 screenshots from the Wodify app; Claude reads them all and produces a single structured session record (sections, movements, load, intensity)
- **Session enrichment** — merges Wodify WOD data with Strava HR/calories/suffer score into a unified `EnrichedSession`
- **Pending match resolution** — upload a screenshot before class; it gets automatically matched to Strava after the next sync
- **Readiness score** — 7-day ATL (Acute Training Load) model, penalises consecutive high-intensity neuromuscular sessions, displayed on the dashboard
- **Weekly scheduling engine** — finds free 1-hour slots in your preferred windows (5–8am / 5–8pm), proposes 3× CrossFit, 1× Run, 1× Bike, avoids back-to-back hard sessions
- **Calendar view** — weekly time-grid with colour-coded activity dots
- **Progress view** — charts weekly volume and training type breakdown
- **Mobile-first light UI** — designed for iPhone use

---

## Tech Stack

- **Next.js 14** (App Router)
- **NextAuth.js** — Google OAuth
- **Google Calendar API v3** — freeBusy + events
- **Strava API** — activity fetch and sync
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) — vision model for Wodify screenshot parsing
- **Vercel KV** (Redis) — stores activities, WOD data, enriched sessions, training load
- **Tailwind CSS**
- **Vercel** — deployment + cron jobs

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `NEXTAUTH_SECRET` | Random secret (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Base URL (`http://localhost:3000` or your Vercel URL) |
| `STRAVA_CLIENT_ID` | Strava API client ID |
| `STRAVA_CLIENT_SECRET` | Strava API client secret |
| `STRAVA_REFRESH_TOKEN` | Long-lived Strava refresh token for your account |
| `KV_REST_API_URL` | Vercel KV endpoint |
| `KV_REST_API_TOKEN` | Vercel KV token |
| `ANTHROPIC_API_KEY` | Anthropic API key (from console.anthropic.com) |
| `CRON_SECRET` | Secret to authenticate Vercel cron requests |

---

## Local Setup

### 1. Clone and install

```bash
git clone https://github.com/yourname/trainsync.git
cd trainsync
npm install
```

### 2. Google Cloud Console

1. Create a project and enable **Google Calendar API**
2. Create an OAuth 2.0 Client ID (Web application)
3. Add redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Copy Client ID and Client Secret

### 3. Strava API

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and create an app
2. Use the OAuth flow to obtain a refresh token with `activity:read_all` scope
3. Copy Client ID, Client Secret, and Refresh Token

### 4. Vercel KV

Create a KV database in the Vercel dashboard and copy the `KV_REST_API_URL` and `KV_REST_API_TOKEN` values. For local dev you can use the same production KV or set up a local Redis instance.

### 5. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with all values from the table above.

### 6. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Vercel Deployment

1. Push to GitHub and import the repo at [vercel.com/new](https://vercel.com/new)
2. Add all environment variables in **Settings → Environment Variables**
3. Add a KV database under **Storage** and link it to the project
4. After deploy, update Google OAuth redirect URIs to include your Vercel URL

### Cron jobs

`vercel.json` schedules a daily Strava sync:

```json
{
  "crons": [{ "path": "/api/cron/sync-strava", "schedule": "0 6 * * *" }]
}
```

The cron calls `runStravaSync()` which fetches recent Strava activities, stores them in KV, updates rolling training load, and resolves any pending Wodify session matches.

---

## Architecture

```
trainsync/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/   # NextAuth handler
│   │   ├── calendar/             # GET: week events with Strava overlay
│   │   ├── cron/sync-strava/     # Strava sync cron endpoint
│   │   ├── readiness/            # GET: daily readiness score
│   │   ├── schedule/             # GET: weekly proposal + completed event IDs
│   │   ├── strava/activities/    # GET: recent activities from KV
│   │   ├── sync/status/          # GET: last sync time + activity counts
│   │   └── wodify/parse/         # POST: parse screenshot(s) via Claude
│   ├── calendar/                 # Weekly time-grid calendar view
│   ├── dashboard/                # Scheduling + readiness dashboard
│   ├── log/                      # Wodify screenshot upload page
│   ├── progress/                 # Charts and training load history
│   ├── providers.tsx
│   ├── layout.tsx
│   └── page.tsx                  # Sign-in landing
├── components/
│   ├── BottomNav.tsx             # 4-tab navigation (Calendar / Schedule / Progress / Log)
│   ├── ReadinessCard.tsx         # ATL-based readiness score display
│   ├── WorkoutCard.tsx           # Per-session card with schedule/unschedule actions
│   ├── WeeklyOverview.tsx        # Session count vs target bar
│   └── TimePickerModal.tsx       # Bottom sheet time picker
├── lib/
│   ├── auth.ts                   # NextAuth config
│   ├── google-calendar.ts        # Google Calendar API helpers
│   ├── kv.ts                     # Vercel KV helpers (activities, wodify, sessions, load)
│   ├── readiness.ts              # ATL computation + consecutive neuromuscular penalty
│   ├── scheduler.ts              # Weekly slot-finding engine
│   ├── sessionMatcher.ts         # Wodify + Strava merge, pending resolution
│   ├── strava.ts                 # Strava API fetch + store
│   └── sync-strava.ts            # Full sync orchestration
└── types/
    ├── index.ts                  # Domain types (WodifyParsed, EnrichedSession, etc.)
    └── next-auth.d.ts            # Session type augmentation
```

---

## Key Data Flows

### Logging a session (Wodify → KV)

1. User uploads 1–3 Wodify screenshots on `/log`
2. All images sent in one request to `POST /api/wodify/parse`
3. Claude reads all screenshots and returns a single `WodifyParsed` JSON (sections, movements, load)
4. Stored in KV as `wodify:YYYY-MM-DD`
5. `matchAndEnrichSession` looks for a matching Strava activity from the same day
6. If found → `EnrichedSession` stored as `session:YYYY-MM-DD` with intensity score and stress type
7. If not found → stored with `pendingMatch: true`; resolved automatically on next Strava sync

### Intensity scoring

```
base: low=3, moderate=5, high=7, very_high=9
+ HR modifier: avg HR > 90% max HR → +2, > 80% → +1
+ suffer score > 100 → +1
clamped to 10
```

### Readiness score

```
daily load = enrichedIntensity (if enriched session exists)
           OR sufferScore / 10 (from Strava activity)
           OR 0

ATL = average of last 7 daily loads
base score = 100 - (ATL × 8)
consecutive neuromuscular penalty (2 days both > 7 intensity) = -10
clamped 0–100
```

---

## Workout Windows

| Window | Hours |
|--------|-------|
| Morning | 5:00 AM – 8:00 AM |
| Evening | 5:00 PM – 8:00 PM |

Slots are scanned in 30-minute increments. The earliest available slot per day is preferred.

## Weekly Plan Template

| Session | Type | Hard? |
|---------|------|-------|
| 1 | CrossFit | Yes |
| 2 | CrossFit | Yes |
| 3 | CrossFit | Yes |
| 4 | Run | No |
| 5 | Bike | No |

Hard sessions (CrossFit) are scheduled to avoid consecutive days where possible.
