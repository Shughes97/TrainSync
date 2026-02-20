/**
 * Vercel Cron Job: /api/cron/strava-sync
 * Schedule: every 4 hours ("0 */4 * * *")
 *
 * Protected by CRON_SECRET header (set by Vercel) OR a valid NextAuth session
 * (for manual "Sync Now" triggers from the dashboard).
 *
 * Required env vars: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET,
 *                    KV_REST_API_URL, KV_REST_API_TOKEN
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getStravaAccessToken } from "@/lib/strava";
import { runStravaSync } from "@/lib/sync-strava";

function isAuthorized(req: NextRequest, sessionExists: boolean): boolean {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }
  return sessionExists;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAuthorized(req, !!session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = await getStravaAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Strava not connected. Visit /api/strava/connect to authorise." },
      { status: 400 }
    );
  }

  try {
    const result = await runStravaSync(accessToken);
    console.log("[strava-sync] complete:", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[strava-sync] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Also handle GET so Vercel cron scheduler can call it (crons use GET by default)
export async function GET(req: NextRequest) {
  return POST(req);
}
