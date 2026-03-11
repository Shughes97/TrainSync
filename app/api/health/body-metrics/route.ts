/**
 * POST /api/health/body-metrics — receives body weight and/or body fat % from iOS Shortcut or manual save.
 * GET  /api/health/body-metrics — returns today's entry + 7-day history state.
 *
 * POST auth: Bearer ${HEALTH_SYNC_SECRET} (for iOS Shortcut) OR valid NextAuth session.
 * GET  auth: valid NextAuth session only.
 *
 * iOS Shortcut body: { "weightKg": 82.5, "bodyFatPct": 18.2 }
 * Either field is optional — at least one must be present.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setBodyMetricsEntry } from "@/lib/kv";
import type { BodyMetricsEntry } from "@/types";

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

function parseNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && !isNaN(n) ? n : null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAuthorized(req, !!session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { weightKg?: unknown; bodyFatPct?: unknown; date?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const weightKg = parseNumber(body.weightKg);
  const bodyFatPct = parseNumber(body.bodyFatPct);

  if (weightKg == null && bodyFatPct == null) {
    return NextResponse.json(
      { error: "At least one of weightKg or bodyFatPct is required" },
      { status: 400 }
    );
  }

  if (weightKg != null && (weightKg < 20 || weightKg > 300)) {
    return NextResponse.json({ error: "weightKg must be between 20 and 300" }, { status: 400 });
  }

  if (bodyFatPct != null && (bodyFatPct < 1 || bodyFatPct > 60)) {
    return NextResponse.json({ error: "bodyFatPct must be between 1 and 60" }, { status: 400 });
  }

  const date = body.date ?? isoDate(new Date());
  const source = body.source === "manual" ? "manual" : "shortcut";

  const entry: BodyMetricsEntry = {
    date,
    weightKg,
    bodyFatPct,
    source,
    createdAt: new Date().toISOString(),
  };

  await setBodyMetricsEntry(entry);

  return NextResponse.json({ ok: true, entry });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  void req;

  const { computeBodyMetricsState } = await import("@/lib/bodyMetrics");
  const state = await computeBodyMetricsState();
  return NextResponse.json(state);
}
