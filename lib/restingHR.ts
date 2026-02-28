/**
 * Resting HR state computation.
 *
 * Data comes from iOS Shortcut → POST /api/health/resting-hr → KV health:resting-hr:YYYY-MM-DD
 * Tracks 7-day history so trends (fitness improving / fatigue accumulating) are visible.
 *
 * Trend interpretation:
 *   Improving  = resting HR dropping   (fitness increasing or good recovery)
 *   Worsening  = resting HR rising     (fatigue, illness, or overtraining)
 *   Stable     = within ±3 bpm of 3-day average
 */

import { kv } from "./kv";
import type { RestingHREntry, RestingHRState } from "@/types";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadEntry(date: string): Promise<RestingHREntry | null> {
  try {
    return await kv.get<RestingHREntry>(`health:resting-hr:${date}`);
  } catch {
    return null;
  }
}

function avgBpm(entries: (RestingHREntry | null)[]): number | null {
  const valid = entries.filter((e): e is RestingHREntry => e != null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, e) => s + e.bpm, 0) / valid.length);
}

function computeTrend(history: (number | null)[]): "improving" | "stable" | "worsening" {
  const valid = history.filter((v): v is number => v != null);
  if (valid.length < 3) return "stable";
  const recent3avg = valid.slice(-3).reduce((s, v) => s + v, 0) / 3;
  const latest = valid[valid.length - 1];
  // For HR: lower is better, so dropping = improving
  if (latest < recent3avg - 2) return "improving";
  if (latest > recent3avg + 2) return "worsening";
  return "stable";
}

export async function computeRestingHRState(now?: Date): Promise<RestingHRState> {
  const today = now ?? new Date();

  // Load last 7 days (today + 6 previous)
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(isoDate(d));
  }

  const entries = await Promise.all(dates.map(loadEntry));

  // Today's reading = entries[6]; fall back to yesterday if not yet received
  const todayEntry = entries[6] ?? entries[5] ?? null;
  const todayBpm = todayEntry?.bpm ?? null;

  const avg7 = avgBpm(entries);
  const history: (number | null)[] = entries.map((e) => e?.bpm ?? null);
  const trend = computeTrend(history);

  return {
    today: todayEntry,
    todayBpm,
    rolling7DayAvgBpm: avg7,
    trend,
    history,
  };
}
