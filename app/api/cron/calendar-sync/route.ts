/**
 * Vercel Cron Job: /api/cron/calendar-sync
 * Schedule: daily at 21:00 UTC ("0 21 * * *")
 *
 * Protected by CRON_SECRET header (set by Vercel) OR a valid NextAuth session
 * (for manual "Sync Now" triggers from the dashboard).
 *
 * Required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *                    KV_REST_API_URL, KV_REST_API_TOKEN
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGoogleAccessToken } from "@/lib/kv";
import { runCalendarSync } from "@/lib/sync-calendar";

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

  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Google Calendar not connected. Sign in with Google to authorise." },
      { status: 400 }
    );
  }

  try {
    const result = await runCalendarSync(accessToken);
    console.log("[calendar-sync] complete:", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[calendar-sync] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Also handle GET so Vercel cron scheduler can call it (crons use GET by default)
export async function GET(req: NextRequest) {
  return POST(req);
}
