# TrainSync

Smart weekly workout scheduling that syncs with Google Calendar.

Automatically finds free 1-hour slots in your preferred workout windows (5–8am and 5–8pm), proposes a balanced weekly plan (3× CrossFit, 1× Run, 1× Bike), and lets you approve and push sessions directly to Google Calendar.

---

## Features

- Google OAuth login with Calendar read/write access
- Scheduling engine that respects your existing calendar events
- Avoids back-to-back hard sessions (CrossFit)
- Accept / Change Time / Skip controls per session
- One-tap "Schedule Week" to create all Google Calendar events
- Weekly progress overview (sessions vs 5-session target)
- Mobile-first dark UI

---

## Tech Stack

- **Next.js 14** (App Router)
- **NextAuth.js** — Google OAuth
- **Google Calendar API v3** — freeBusy + events
- **Tailwind CSS** — utility-first styling
- **Vercel** — deployment target

---

## Local Setup

### 1. Clone and install

```bash
git clone https://github.com/yourname/trainsync.git
cd trainsync
npm install
```

### 2. Google Cloud Console — Create OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library**
   - Enable **Google Calendar API**
4. Go to **APIs & Services → OAuth consent screen**
   - Choose **External** user type
   - Fill in app name ("TrainSync"), user support email, developer email
   - Add scopes:
     - `https://www.googleapis.com/auth/calendar.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
   - Add your email as a test user (while in development)
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins:
     - `http://localhost:3000`
     - `https://your-app.vercel.app`
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://your-app.vercel.app/api/auth/callback/google`
6. Copy the **Client ID** and **Client Secret**

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
NEXTAUTH_SECRET=<run: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Vercel Deployment

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial TrainSync"
git remote add origin https://github.com/yourname/trainsync.git
git push -u origin main
```

### 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repo
3. Add environment variables in **Settings → Environment Variables**:

| Name | Value |
|------|-------|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `NEXTAUTH_SECRET` | Output of `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` |

4. Deploy

### 3. Update Google OAuth redirect URIs

After getting your Vercel URL, go back to Google Cloud Console → Credentials and add:
- Authorized JavaScript origins: `https://your-app.vercel.app`
- Authorized redirect URIs: `https://your-app.vercel.app/api/auth/callback/google`

---

## Architecture

```
trainsync/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/  # NextAuth handler
│   │   ├── calendar/            # GET: fetch week events, POST: create events
│   │   └── schedule/            # GET: build weekly proposal
│   ├── dashboard/               # Main workout planning UI
│   ├── providers.tsx            # SessionProvider wrapper
│   ├── layout.tsx
│   └── page.tsx                 # Sign-in landing
├── components/
│   ├── WorkoutCard.tsx          # Per-session card with actions
│   ├── WeeklyOverview.tsx       # Progress summary panel
│   └── TimePickerModal.tsx      # Bottom sheet time picker
├── lib/
│   ├── auth.ts                  # NextAuth config
│   ├── google-calendar.ts       # Google Calendar API helpers
│   └── scheduler.ts             # Core scheduling engine (isolated)
└── types/
    ├── index.ts                 # Domain types
    └── next-auth.d.ts           # Session type augmentation
```

### Extending the Scheduler

`lib/scheduler.ts` exposes a clean `buildWeeklyPlan(options: SchedulerOptions)` interface.

To add fatigue or load tracking later, pass data via `SchedulerOptions`:

```ts
const result = buildWeeklyPlan({
  busySlots,
  weekStart,
  fatigueByDay: { "2024-01-15": 7, "2024-01-16": 3 },
});
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
