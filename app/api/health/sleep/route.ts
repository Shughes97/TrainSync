/**
 * POST /api/health/sleep — receives sleep data from iOS Shortcut or manual entry.
 * GET  /api/health/sleep?date=YYYY-MM-DD — returns stored SleepEntry for that date.
 *
 * POST auth: Bearer ${HEALTH_SYNC_SECRET} (for iOS Shortcut) OR valid NextAuth session.
 * GET  auth: valid NextAuth session only.
 *
 * iOS Shortcut body: { "date": "YYYY-MM-DD", "hours": 7.5 }
 * Full body:         { "date": "YYYY-MM-DD", "hours": 7.5, "deepMins": 90, "remMins": 120 }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setSleepEntry, getSleepEntry } from "@/lib/kv";
import type { SleepEntry } from "@/types";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isAuthorized(req: NextRequest, sessionExists: boolean): boolean {
  const secret = process.env.HEALTH_SYNC_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${secret}`) return true;
  }
  return sessionExists;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAuthorized(req, !!session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    date?: string;
    hours?: number;
    asleepMins?: number;
    deepMins?: number;
    remMins?: number;
    source?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const hours = body.hours;
  if (typeof hours !== "number" || hours < 0 || hours > 24) {
    return NextResponse.json({ error: "hours must be a number between 0 and 24" }, { status: 400 });
  }

  const date = body.date ?? isoDate(new Date());
  const source = body.source === "manual" ? "manual" : "shortcut";

  const entry: SleepEntry = {
    date,
    hours: Math.round(hours * 10) / 10,
    asleepMins: body.asleepMins ?? Math.round(hours * 60),
    deepMins: body.deepMins ?? null,
    remMins: body.remMins ?? null,
    source,
    createdAt: new Date().toISOString(),
  };

  await setSleepEntry(entry);

  // Fire-and-forget fatigue snapshot refresh so readiness updates immediately
  try {
    const { computeFatigueSnapshot } = await import("@/lib/fatigue");
    const { setFatigueSnapshot } = await import("@/lib/kv");
    computeFatigueSnapshot().then((snap) => setFatigueSnapshot(snap)).catch(() => {});
  } catch {
    // non-critical
  }

  return NextResponse.json({ ok: true, entry });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? isoDate(new Date());
  const entry = await getSleepEntry(date);
  return NextResponse.json(entry ?? null);
}
