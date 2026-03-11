/**
 * Body metrics state computation.
 *
 * Data comes from iOS Shortcut → POST /api/health/body-metrics → KV health:body-metrics:YYYY-MM-DD
 * Tracks 7-day and 30-day history so weight and body fat trends are visible.
 *
 * Trend interpretation:
 *   up     = value rising over the last 3 days vs prior
 *   down   = value dropping over the last 3 days vs prior
 *   stable = within ±0.5 kg / ±0.5 % of 3-day average
 */

import { kv } from "./kv";
import type { BodyMetricsEntry, BodyMetricsState } from "@/types";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadEntry(date: string): Promise<BodyMetricsEntry | null> {
  try {
    return await kv.get<BodyMetricsEntry>(`health:body-metrics:${date}`);
  } catch {
    return null;
  }
}

function avg(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 10) / 10;
}

function computeTrend(
  history: (number | null)[],
  threshold: number
): "up" | "down" | "stable" {
  const valid = history.filter((v): v is number => v != null);
  if (valid.length < 3) return "stable";
  const recent3avg = valid.slice(-3).reduce((s, v) => s + v, 0) / 3;
  const latest = valid[valid.length - 1];
  if (latest > recent3avg + threshold) return "up";
  if (latest < recent3avg - threshold) return "down";
  return "stable";
}

export async function computeBodyMetricsState(now?: Date): Promise<BodyMetricsState> {
  const today = now ?? new Date();

  // Build date arrays: 7 days for display, 30 days for longer avg
  const dates30: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates30.push(isoDate(d));
  }

  const entries30 = await Promise.all(dates30.map(loadEntry));
  const entries7 = entries30.slice(-7);

  // Today's reading = last entry; fall back to yesterday if not yet received
  const todayEntry = entries7[6] ?? entries7[5] ?? null;
  const todayWeightKg = todayEntry?.weightKg ?? null;
  const todayBodyFatPct = todayEntry?.bodyFatPct ?? null;

  const weightHistory7: (number | null)[] = entries7.map((e) => e?.weightKg ?? null);
  const bodyFatHistory7: (number | null)[] = entries7.map((e) => e?.bodyFatPct ?? null);

  const rolling7DayAvgWeightKg = avg(weightHistory7);
  const rolling30DayAvgWeightKg = avg(entries30.map((e) => e?.weightKg ?? null));
  const rolling7DayAvgBodyFatPct = avg(bodyFatHistory7);

  const weightTrend = computeTrend(weightHistory7, 0.5);
  const bodyFatTrend = computeTrend(bodyFatHistory7, 0.5);

  return {
    today: todayEntry,
    todayWeightKg,
    todayBodyFatPct,
    rolling7DayAvgWeightKg,
    rolling30DayAvgWeightKg,
    rolling7DayAvgBodyFatPct,
    weightTrend,
    bodyFatTrend,
    weightHistory: weightHistory7,
    bodyFatHistory: bodyFatHistory7,
  };
}
