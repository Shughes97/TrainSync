/**
 * GET /api/dashboard — aggregates all training data for the dashboard.
 * Cached hourly in KV at dashboard:cache:YYYY-MM-DD:HH.
 * Add ?bust=1 to bypass cache (pull-to-refresh).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getFatigueSnapshot,
  getAthleteProfile,
  getActivities,
  getRecentEnrichedSessions,
  getSleepEntry,
  getRestingHREntry,
  getBodyMetricsEntry,
  kv,
} from "@/lib/kv";
import type { SleepEntry, RestingHREntry, BodyMetricsEntry, EnrichedSession } from "@/types";
import type { StoredWeekSchedule } from "@/lib/kv";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function avgHoursCalc(entries: (SleepEntry | null)[]): number | null {
  const valid = entries.filter((e): e is SleepEntry => e !== null);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((s, e) => s + e.hours, 0) / valid.length) * 10) / 10;
}

function avgBpmCalc(entries: (RestingHREntry | null)[]): number | null {
  const valid = entries.filter((e): e is RestingHREntry => e !== null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, e) => s + e.bpm, 0) / valid.length);
}

function avgWeightCalc(entries: (BodyMetricsEntry | null)[]): number | null {
  const valid = entries.filter((e): e is BodyMetricsEntry => e !== null && e.weightKg != null);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((s, e) => s + e.weightKg!, 0) / valid.length) * 10) / 10;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const dateStr = isoDate(today);
  const hourStr = today.getHours().toString().padStart(2, "0");
  const cacheKey = `dashboard:cache:${dateStr}:${hourStr}`;

  const { searchParams } = new URL(req.url);
  const bust = searchParams.get("bust");

  if (!bust) {
    try {
      const cached = await kv.get<unknown>(cacheKey);
      if (cached) return NextResponse.json(cached);
    } catch {
      // ignore cache miss errors
    }
  }

  try {
    // Build date arrays
    const dates30: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dates30.push(isoDate(d));
    }

    const dates14: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dates14.push(isoDate(d));
    }

    const [
      snapshot,
      weekSchedule,
      sleepEntries30,
      rhrEntries30,
      bodyMetricsEntries30,
      recentSessions,
      activities,
      profile,
      fatigueHistory,
    ] = await Promise.all([
      getFatigueSnapshot(dateStr),
      kv.get<StoredWeekSchedule>("schedule:current_week"),
      Promise.all(dates30.map((d) => getSleepEntry(d))),
      Promise.all(dates30.map((d) => getRestingHREntry(d))),
      Promise.all(dates30.map((d) => getBodyMetricsEntry(d))),
      getRecentEnrichedSessions(14),
      getActivities(),
      getAthleteProfile(),
      Promise.all(
        dates14.map(async (d) => {
          const [neuro, cardio, metabolic] = await Promise.all([
            kv.get<number>(`fatigue:neuromuscular:${d}`).catch(() => null),
            kv.get<number>(`fatigue:cardiovascular:${d}`).catch(() => null),
            kv.get<number>(`fatigue:metabolic:${d}`).catch(() => null),
          ]);
          return {
            date: d,
            label: new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            }),
            neuromuscular: neuro ?? 0,
            cardiovascular: cardio ?? 0,
            metabolic: metabolic ?? 0,
          };
        })
      ),
    ]);

    // Most recent non-null enriched session
    const lastSession: EnrichedSession | null =
      [...recentSessions].reverse().find((s): s is EnrichedSession => s !== null) ?? null;

    const sleepLast7 = sleepEntries30.slice(-7);
    const sleepAvg30Hours = avgHoursCalc(sleepEntries30);
    const rhrLast7 = rhrEntries30.slice(-7);
    const rhrAvg30Bpm = avgBpmCalc(rhrEntries30);
    const bodyMetricsLast7 = bodyMetricsEntries30.slice(-7);
    const bodyMetricsAvg30WeightKg = avgWeightCalc(bodyMetricsEntries30);

    const result = {
      snapshot: snapshot ?? null,
      schedule: weekSchedule ? { sessions: weekSchedule.sessions } : null,
      sleepLast7,
      sleepAvg30Hours,
      rhrLast7,
      rhrAvg30Bpm,
      bodyMetricsLast7,
      bodyMetricsAvg30WeightKg,
      lastSession,
      activities,
      fatigueHistory,
      profile: profile ?? null,
      cachedAt: new Date().toISOString(),
    };

    try {
      await kv.set(cacheKey, result, { ex: 3600 });
    } catch {
      // ignore cache write errors
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[dashboard] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
