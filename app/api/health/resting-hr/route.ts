/**
 * POST /api/health/resting-hr — receives resting heart rate from iOS Shortcut or manual save.
 * GET  /api/health/resting-hr — returns current restingHR from athlete profile.
 *
 * POST auth: Bearer ${HEALTH_SYNC_SECRET} (for iOS Shortcut) OR valid NextAuth session.
 * GET  auth: valid NextAuth session only.
 *
 * iOS Shortcut body: { "bpm": 52 }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAthleteProfile, setAthleteProfile } from "@/lib/kv";

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

  let body: { bpm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bpm = typeof body.bpm === "string" ? parseInt(body.bpm, 10) : body.bpm;
  if (typeof bpm !== "number" || isNaN(bpm) || bpm < 30 || bpm > 120) {
    return NextResponse.json({ error: "bpm must be a number between 30 and 120" }, { status: 400 });
  }

  const existing = await getAthleteProfile();
  if (!existing) {
    return NextResponse.json({ error: "Athlete profile not found" }, { status: 404 });
  }

  const updated = { ...existing, restingHR: bpm };
  await setAthleteProfile(updated);

  // Fire-and-forget fatigue snapshot refresh so HRV score updates immediately
  try {
    const { computeFatigueSnapshot } = await import("@/lib/fatigue");
    const { setFatigueSnapshot } = await import("@/lib/kv");
    computeFatigueSnapshot().then((snap) => setFatigueSnapshot(snap)).catch(() => {});
  } catch {
    // non-critical
  }

  return NextResponse.json({ ok: true, restingHR: bpm });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // suppress unused warning
  void req;

  const profile = await getAthleteProfile();
  return NextResponse.json({ restingHR: profile?.restingHR ?? null });
}
