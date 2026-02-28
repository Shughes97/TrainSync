/**
 * POST /api/health/resting-hr — receives resting heart rate from iOS Shortcut or manual save.
 * GET  /api/health/resting-hr — returns today's RestingHREntry + 7-day history.
 *
 * POST auth: Bearer ${HEALTH_SYNC_SECRET} (for iOS Shortcut) OR valid NextAuth session.
 * GET  auth: valid NextAuth session only.
 *
 * iOS Shortcut body: { "bpm": 52 }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAthleteProfile, setAthleteProfile, setRestingHREntry } from "@/lib/kv";
import type { RestingHREntry } from "@/types";

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

  let body: { bpm?: unknown; date?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bpm = typeof body.bpm === "string" ? parseInt(body.bpm, 10) : body.bpm;
  if (typeof bpm !== "number" || isNaN(bpm) || bpm < 30 || bpm > 120) {
    return NextResponse.json({ error: "bpm must be a number between 30 and 120" }, { status: 400 });
  }

  const date = body.date ?? isoDate(new Date());
  const source = body.source === "manual" ? "manual" : "shortcut";

  const entry: RestingHREntry = {
    date,
    bpm,
    source,
    createdAt: new Date().toISOString(),
  };

  // Store daily entry for history tracking
  await setRestingHREntry(entry);

  // Also update athlete profile so existing HRV calc stays current
  const existing = await getAthleteProfile();
  if (existing) {
    await setAthleteProfile({ ...existing, restingHR: bpm });
  }

  // Fire-and-forget fatigue snapshot refresh
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

  void req;

  const { computeRestingHRState } = await import("@/lib/restingHR");
  const state = await computeRestingHRState();
  return NextResponse.json(state);
}
