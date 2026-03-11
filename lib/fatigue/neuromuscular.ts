/**
 * Neuromuscular fatigue — tracks mechanical stress from strength/lifting sessions.
 *
 * Half-life: 72 hours (extended by metabolic fatigue state).
 * Primary source: session.neuromuscularLoad (0-100 from notes parser).
 * Fallback: estimated from Strava duration for Crossfit/Strength/WeightTraining sessions.
 */

import type { EnrichedSession, FatigueSystemState } from "@/types";
import type { StoredActivity } from "@/lib/kv";

const GYM_TYPES = new Set(["WeightTraining", "Crossfit", "Strength", "Workout"]);
const BASE_HALF_LIFE = 72; // hours

export function decay(
  load: number,
  hoursSinceSession: number,
  metabolicFatigue: number
): number {
  const effectiveHalfLife =
    BASE_HALF_LIFE * (1 + (metabolicFatigue / 100) * 0.5);
  return load * Math.pow(0.5, hoursSinceSession / effectiveHalfLife);
}

function estimatedRecoveryHours(score: number, metabolicFatigue: number): number {
  if (score <= 40) return 0;
  const effectiveHalfLife =
    BASE_HALF_LIFE * (1 + (metabolicFatigue / 100) * 0.5);
  return Math.round(effectiveHalfLife * Math.log2(score / 40));
}

function isoToDate(iso: string): Date {
  // Handles both "2026-02-25" and "2026-02-25T08:00:00Z"
  // Use midnight UTC for date-only strings so same-day sessions are never "in the future"
  return new Date(iso.includes("T") ? iso : iso + "T00:00:00Z");
}

function sessionLabel(session: EnrichedSession): string {
  const namedSection = session.wod?.sections?.find(
    (s) => s.name && s.name.toLowerCase() !== "unknown"
  );
  if (namedSection) return `${namedSection.name} (${session.date})`;
  const box = session.wod?.box;
  if (box && box.toLowerCase() !== "unknown") return `${box} WOD (${session.date})`;
  return `Session (${session.date})`;
}

/**
 * Returns true if the session has WOD sections with non-cardio muscle groups,
 * meaning it has weighted or gymnastics movements with neuromuscular demand.
 */
function isNonCardioMetcon(session: EnrichedSession): boolean {
  const sections = session.wod?.sections;
  if (!sections || sections.length === 0) return false;
  return sections.some((s) =>
    s.dominantMuscleGroups.some((mg) => mg !== "cardio")
  );
}

interface SessionPoint {
  load: number;
  startDate: Date;
  description: string;
}

export function computeNeuromuscularFatigue(
  sessions: (EnrichedSession | null)[],
  activities: StoredActivity[],
  now: Date,
  metabolicFatigue: number,
  history: number[]
): FatigueSystemState {
  const points: SessionPoint[] = [];

  // Collect from enriched sessions
  for (const session of sessions) {
    if (!session) continue;

    const sessionDate = isoToDate(session.date);
    const description = sessionLabel(session);

    if (session.neuromuscularLoad != null && session.neuromuscularLoad > 0) {
      points.push({ load: session.neuromuscularLoad, startDate: sessionDate, description });
      continue;
    }

    // Fallback for strength sessions without notes: estimate from duration via Strava
    if (
      session.dominantStressType === "neuromuscular" ||
      session.source === "strava_only"
    ) {
      const activityId = session.performance?.stravaActivityId;
      const activity = activities.find(
        (a) =>
          (activityId != null && a.id === activityId) ||
          (GYM_TYPES.has(a.type) && a.start_date.startsWith(session.date))
      );
      if (activity) {
        // 1hr of gym work ≈ 60 load units (raw), normalised against 100 cap
        const rawLoad = Math.min((activity.moving_time / 3600) * 60, 100);
        points.push({ load: rawLoad, startDate: sessionDate, description });
      }
      continue;
    }

    // Fallback for metcon/mixed sessions: almost all CrossFit metcons involve weighted or
    // gymnastics movements with neuromuscular demand. Estimate from enrichedIntensity unless
    // the WOD is purely cardio (run/row/bike only).
    if (
      (session.dominantStressType === "cardiovascular" ||
        session.dominantStressType === "mixed") &&
      session.enrichedIntensity != null &&
      session.enrichedIntensity > 0 &&
      isNonCardioMetcon(session)
    ) {
      const rawLoad = session.enrichedIntensity * 7; // intensity 1-10 → load 7-70
      points.push({ load: rawLoad, startDate: sessionDate, description });
    }
  }

  // Also pick up gym activities that didn't match an enriched session
  const enrichedDates = new Set(
    sessions.filter(Boolean).map((s) => s!.date)
  );
  for (const activity of activities) {
    if (!GYM_TYPES.has(activity.type)) continue;
    const dateStr = activity.start_date.substring(0, 10);
    if (enrichedDates.has(dateStr)) continue;
    const actDate = isoToDate(activity.start_date);
    const hoursSince = (now.getTime() - actDate.getTime()) / 3600000;
    if (hoursSince > 14 * 24) continue; // outside 14-day window
    const rawLoad = Math.min((activity.moving_time / 3600) * 60, 100);
    points.push({
      load: rawLoad,
      startDate: actDate,
      description: `${activity.name} (${dateStr})`,
    });
  }

  // Apply decay and sum
  let totalDecayed = 0;
  let primaryDriver = "No recent strength sessions";
  let lastHardSessionHours = 0;

  // Sort by most recent first to find primary driver
  const sorted = [...points].sort(
    (a, b) => b.startDate.getTime() - a.startDate.getTime()
  );

  for (const point of sorted) {
    const hoursSince = (now.getTime() - point.startDate.getTime()) / 3600000;
    if (hoursSince < 0) continue;
    totalDecayed += decay(point.load, hoursSince, metabolicFatigue);
  }

  const mostRecentPast = sorted.find(
    (p) => (now.getTime() - p.startDate.getTime()) / 3600000 >= 0
  );
  if (mostRecentPast) {
    lastHardSessionHours = Math.round(
      (now.getTime() - mostRecentPast.startDate.getTime()) / 3600000
    );
    primaryDriver = `${mostRecentPast.description} — ${lastHardSessionHours}h ago`;
  }

  const score = Math.round(Math.min(totalDecayed, 100));
  const freshness = 100 - score;

  return {
    score,
    freshness,
    trend: computeTrend(score, history),
    lastHardSessionHours,
    estimatedRecoveryHours: estimatedRecoveryHours(score, metabolicFatigue),
    primaryDriver,
    history,
  };
}

function computeTrend(
  todayScore: number,
  history: number[]
): "improving" | "stable" | "worsening" {
  const recent = history.slice(-3);
  if (recent.length < 2) return "stable";
  const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
  if (todayScore < avg - 5) return "improving";
  if (todayScore > avg + 5) return "worsening";
  return "stable";
}
