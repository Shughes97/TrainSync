/**
 * Cardiovascular fatigue — TRIMP (Training Impulse) model.
 *
 * Half-life: 48 hours.
 * Sources: Strava aerobic activities (Run, Ride, VirtualRide) + CrossFit with HR data.
 * Requires maxHR and restingHR from athlete profile for accurate calculation.
 */

import type { EnrichedSession, AthleteProfile, FatigueSystemState } from "@/types";
import type { StoredActivity } from "@/lib/kv";

const HALF_LIFE = 48; // hours
const AEROBIC_TYPES = new Set(["Run", "VirtualRun", "Ride", "VirtualRide", "Crossfit", "WeightTraining", "Walk", "Hike"]);

export function calculateTRIMP(
  durationMins: number,
  avgHR: number,
  restingHR: number,
  maxHR: number
): number {
  const hrRange = maxHR - restingHR;
  if (hrRange <= 0) return durationMins * 0.5;
  const hrRatio = Math.max(0, Math.min(1, (avgHR - restingHR) / hrRange));
  return durationMins * hrRatio * 0.64 * Math.exp(1.92 * hrRatio);
}

export function decay(trimp: number, hoursSinceSession: number): number {
  return trimp * Math.pow(0.5, hoursSinceSession / HALF_LIFE);
}

function estimatedRecoveryHours(score: number): number {
  if (score <= 40) return 0;
  return Math.round(HALF_LIFE * Math.log2(score / 40));
}

function isoToDate(iso: string): Date {
  return new Date(iso.includes("T") ? iso : iso + "T12:00:00Z");
}

interface TRIMPPoint {
  trimp: number;
  startDate: Date;
  description: string;
}

export function computeCardiovascularFatigue(
  sessions: (EnrichedSession | null)[],
  activities: StoredActivity[],
  athleteProfile: AthleteProfile | null,
  now: Date,
  history: number[]
): FatigueSystemState {
  const restingHR = athleteProfile?.restingHR ?? 60; // reasonable default
  const maxHR = athleteProfile?.maxHR ?? 185;        // reasonable default

  const points: TRIMPPoint[] = [];
  const enrichedActivityIds = new Set<number>();

  // Collect TRIMP from activities linked to enriched sessions
  for (const session of sessions) {
    if (!session?.performance) continue;
    const actId = session.performance.stravaActivityId;
    if (actId) enrichedActivityIds.add(actId);

    const durationMins = session.performance.duration;
    const avgHR = session.performance.averageHR;
    const startDate = isoToDate(session.date);

    let trimp: number;
    if (avgHR != null) {
      trimp = calculateTRIMP(durationMins, avgHR, restingHR, maxHR);
    } else if (session.performance.sufferScore != null) {
      trimp = session.performance.sufferScore * 2;
    } else {
      trimp = durationMins * 0.5;
    }

    // Only count sessions that have a cardiovascular component
    const isAerobic =
      session.dominantStressType === "cardiovascular" ||
      session.dominantStressType === "mixed" ||
      (session.wod?.sessionType === "metcon_only") ||
      (session.wod?.sessionType === "strength_and_metcon") ||
      (session.source === "strava_only");

    if (isAerobic && trimp > 0) {
      const desc = session.wod?.box
        ? `${session.wod.box} WOD (${session.date})`
        : `Session (${session.date})`;
      points.push({ trimp, startDate, description: desc });
    }
  }

  // Pick up aerobic activities not matched to enriched sessions
  for (const activity of activities) {
    if (!AEROBIC_TYPES.has(activity.type)) continue;
    if (enrichedActivityIds.has(activity.id)) continue;

    const actDate = isoToDate(activity.start_date);
    const hoursSince = (now.getTime() - actDate.getTime()) / 3600000;
    if (hoursSince > 14 * 24) continue;

    const durationMins = activity.moving_time / 60;
    let trimp: number;
    if (activity.average_heartrate != null) {
      trimp = calculateTRIMP(durationMins, activity.average_heartrate, restingHR, maxHR);
    } else if (activity.suffer_score != null) {
      trimp = activity.suffer_score * 2;
    } else {
      trimp = durationMins * 0.5;
    }

    if (trimp > 0) {
      points.push({
        trimp,
        startDate: actDate,
        description: `${activity.name} (${activity.start_date.substring(0, 10)})`,
      });
    }
  }

  // Compute historical TRIMP range for normalisation (use all collected raw TRIMPs)
  const allTrimps = points.map((p) => p.trimp);
  const maxTrimp = allTrimps.length > 0 ? Math.max(...allTrimps) : 200;
  const normFactor = Math.max(maxTrimp, 200); // floor at 200 to avoid over-scaling in early use

  // Apply decay and sum
  let totalDecayed = 0;
  let primaryDriver = "No recent aerobic sessions";
  let lastHardSessionHours = 0;

  const sorted = [...points].sort(
    (a, b) => b.startDate.getTime() - a.startDate.getTime()
  );

  for (const point of sorted) {
    const hoursSince = (now.getTime() - point.startDate.getTime()) / 3600000;
    if (hoursSince < 0) continue;
    const decayedTrimp = decay(point.trimp, hoursSince);
    totalDecayed += decayedTrimp;
  }

  if (sorted.length > 0) {
    const mostRecent = sorted[0];
    lastHardSessionHours = Math.round(
      (now.getTime() - mostRecent.startDate.getTime()) / 3600000
    );
    primaryDriver = `${mostRecent.description} — ${lastHardSessionHours}h ago`;
  }

  // Normalise: decayed sum / normFactor * 100, capped at 100
  const score = Math.round(Math.min((totalDecayed / normFactor) * 100, 100));
  const freshness = 100 - score;

  return {
    score,
    freshness,
    trend: computeTrend(score, history),
    lastHardSessionHours,
    estimatedRecoveryHours: estimatedRecoveryHours(score),
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
