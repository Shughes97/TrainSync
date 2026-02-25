/**
 * Vercel Cron Job: /api/cron/fatigue-calc
 * Schedule: daily at 22:00 UTC ("0 22 * * *") — runs after strava-sync at 21:00 UTC
 *
 * Protected by CRON_SECRET header (set by Vercel) OR a valid NextAuth session.
 *
 * Computes all three fatigue systems and stores the full FatigueSnapshot in KV.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { computeFatigueSnapshot } from "@/lib/fatigue";
import { setFatigueSnapshot } from "@/lib/kv";

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

  try {
    const snapshot = await computeFatigueSnapshot();
    await setFatigueSnapshot(snapshot);
    console.log("[fatigue-calc] complete:", snapshot.date, "overall:", snapshot.overall.score);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    console.error("[fatigue-calc] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Also handle GET so Vercel cron scheduler can call it (crons use GET by default)
export async function GET(req: NextRequest) {
  return POST(req);
}
