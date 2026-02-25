/**
 * Sleep scoring and state computation.
 *
 * Data comes from iOS Shortcut → POST /api/health/sleep → KV sleep:data:YYYY-MM-DD
 * Three scores computed: last night, 3-day rolling average, 7-day rolling average.
 * Overall sleep score: lastNight×50% + 3day×30% + 7day×20%
 */

import { kv } from "./kv";
import type { SleepEntry, SleepState } from "@/types";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Score a single night of sleep on a 0-100 scale.
 * Optimal = 8 hours. Under-sleep penalised more steeply than over-sleep.
 *   8h → 100, 7h → 82, 6h → 64, 5h → 46
 *   9h → 90, 10h → 80
 */
export function sleepHoursToScore(hours: number): number {
  const optimal = 8.0;
  if (hours >= optimal) {
    return Math.max(0, Math.round(100 - (hours - optimal) * 10));
  }
  return Math.max(0, Math.round(100 - (optimal - hours) * 18));
}

/**
 * Weighted composite: lastNight 50%, 3-day 30%, 7-day 20%.
 * Adjusts weights proportionally if some values are missing.
 */
export function computeOverallSleepScore(
  lastNightScore: number | null,
  rolling3DayScore: number | null,
  rolling7DayScore: number | null
): number | null {
  const items: { score: number; weight: number }[] = [];
  if (lastNightScore != null) items.push({ score: lastNightScore, weight: 0.50 });
  if (rolling3DayScore != null) items.push({ score: rolling3DayScore, weight: 0.30 });
  if (rolling7DayScore != null) items.push({ score: rolling7DayScore, weight: 0.20 });
  if (items.length === 0) return null;

  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const weighted = items.reduce((s, i) => s + i.score * i.weight, 0);
  return Math.round(weighted / totalWeight);
}

function computeTrend(scores: (number | null)[]): "improving" | "stable" | "worsening" {
  const valid = scores.filter((s): s is number => s != null);
  if (valid.length < 3) return "stable";
  const recent = valid.slice(-3);
  const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const latest = valid[valid.length - 1];
  if (latest > avg + 5) return "improving";
  if (latest < avg - 5) return "worsening";
  return "stable";
}

async function loadSleepEntry(date: string): Promise<SleepEntry | null> {
  try {
    return await kv.get<SleepEntry>(`sleep:data:${date}`);
  } catch {
    return null;
  }
}

function avgHours(entries: (SleepEntry | null)[]): number | null {
  const valid = entries.filter((e): e is SleepEntry => e != null);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((s, e) => s + e.hours, 0) / valid.length) * 10) / 10;
}

export async function computeSleepState(now?: Date): Promise<SleepState> {
  const today = now ?? new Date();

  // Load last 7 nights (yesterday = last night since we look back from today)
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(isoDate(d));
  }

  const entries = await Promise.all(dates.map(loadSleepEntry));

  // last night = yesterday (entries[5]), today's entry might also be present if user logged early
  // Use entries[6] (today) first, fall back to entries[5] (yesterday)
  const lastNight = entries[6] ?? entries[5] ?? null;

  // 3-day window: last 3 nights
  const last3 = entries.slice(4); // entries[4], [5], [6]
  const last7 = entries;

  const avg3 = avgHours(last3);
  const avg7 = avgHours(last7);

  const lastNightScore = lastNight ? sleepHoursToScore(lastNight.hours) : null;
  const rolling3DayScore = avg3 != null ? sleepHoursToScore(avg3) : null;
  const rolling7DayScore = avg7 != null ? sleepHoursToScore(avg7) : null;
  const overallSleepScore = computeOverallSleepScore(lastNightScore, rolling3DayScore, rolling7DayScore);

  // History = nightly hours for sparkline
  const history: (number | null)[] = entries.map((e) => e?.hours ?? null);

  // Trend based on per-night scores
  const nightlyScores = entries.map((e) => (e ? sleepHoursToScore(e.hours) : null));
  const trend = computeTrend(nightlyScores);

  return {
    lastNight,
    lastNightScore,
    rolling3DayAvgHours: avg3,
    rolling3DayScore,
    rolling7DayAvgHours: avg7,
    rolling7DayScore,
    overallSleepScore,
    trend,
    history,
  };
}
