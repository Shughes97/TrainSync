/**
 * Metabolic fatigue — tracks energy system and systemic stress.
 *
 * Half-life: 60 hours.
 * Sources: Strava suffer_score + session RPE from notes + estimated time above 90% maxHR.
 * Only applies to high-intensity sessions (metcons, intervals, hard CrossFit).
 * Pure strength sessions with no cardiovascular component contribute minimally.
 */

import type { EnrichedSession, AthleteProfile, FatigueSystemState } from "@/types";
import type { StoredActivity } from "@/lib/kv";

const HALF_LIFE = 60; // hours
const HIGH_INTENSITY_TYPES = new Set(["Run", "VirtualRun", "Ride", "VirtualRide", "Crossfit"]);

/**
 * Estimate minutes above 90% of maxHR using a linear model.
 * 0% of time above 90% when avgHR = 80% of maxHR.
 * 100% of time above 90% when avgHR = 100% of maxHR.
 */
export function estimateMinsAbove90(
  avgHR: number,
  maxHR: number,
  durationMins: number
): number {
  if (maxHR <= 0) return 0;
  const ratio = avgHR / maxHR;
  const fraction = Math.max(0, (ratio - 0.80) / 0.20);
  return fraction * durationMins;
}

export function calculateMetabolicLoad(
  sufferScore: number,
  sessionRPE: number,     // 1-10
  minsAbove90: number
): number {
  return (sufferScore * 0.4) + (sessionRPE * 10 * 0.3) + (minsAbove90 * 2 * 0.3);
}

export function decay(load: number, hoursSinceSession: number): number {
  return load * Math.pow(0.5, hoursSinceSession / HALF_LIFE);
}

function estimatedRecoveryHours(score: number): number {
  if (score <= 40) return 0;
  return Math.round(HALF_LIFE * Math.log2(score / 40));
}

function isoToDate(iso: string): Date {
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

interface MetabolicPoint {
  load: number;
  startDate: Date;
  description: string;
}

export function computeMetabolicFatigue(
  sessions: (EnrichedSession | null)[],
  activities: StoredActivity[],
  athleteProfile: AthleteProfile | null,
  now: Date,
  history: number[]
): FatigueSystemState {
  const maxHR = athleteProfile?.maxHR ?? 185;
  const points: MetabolicPoint[] = [];
  const enrichedActivityIds = new Set<number>();

  for (const session of sessions) {
    if (!session) continue;

    // Skip pure strength sessions — low metabolic contribution
    if (
      session.dominantStressType === "neuromuscular" &&
      !session.performance?.sufferScore &&
      !session.performance?.averageHR
    ) {
      continue;
    }

    const actId = session.performance?.stravaActivityId;
    if (actId) enrichedActivityIds.add(actId);

    const startDate = isoToDate(session.date);
    const durationMins = session.performance?.duration ?? 0;
    const avgHR = session.performance?.averageHR ?? 0;
    const sufferScore = session.performance?.sufferScore ?? 0;
    const sessionRPE = session.sessionNotes?.parsed.sessionRPE ?? 5;
    const minsAbove90 = estimateMinsAbove90(avgHR, maxHR, durationMins);

    const rawLoad = calculateMetabolicLoad(sufferScore, sessionRPE, minsAbove90);
    if (rawLoad <= 0) continue;

    points.push({ load: rawLoad, startDate, description: sessionLabel(session) });
  }

  // Pick up high-intensity activities not matched to enriched sessions
  for (const activity of activities) {
    if (!HIGH_INTENSITY_TYPES.has(activity.type)) continue;
    if (enrichedActivityIds.has(activity.id)) continue;

    const actDate = isoToDate(activity.start_date);
    const hoursSince = (now.getTime() - actDate.getTime()) / 3600000;
    if (hoursSince > 14 * 24) continue;

    const durationMins = activity.moving_time / 60;
    const avgHR = activity.average_heartrate ?? 0;
    const sufferScore = activity.suffer_score ?? 0;
    const minsAbove90 = estimateMinsAbove90(avgHR, maxHR, durationMins);
    const rawLoad = calculateMetabolicLoad(sufferScore, 5, minsAbove90);

    if (rawLoad > 0) {
      points.push({
        load: rawLoad,
        startDate: actDate,
        description: `${activity.name} (${activity.start_date.substring(0, 10)})`,
      });
    }
  }

  // Apply decay and sum
  let totalDecayed = 0;
  let primaryDriver = "No recent high-intensity sessions";
  let lastHardSessionHours = 0;

  const sorted = [...points].sort(
    (a, b) => b.startDate.getTime() - a.startDate.getTime()
  );

  for (const point of sorted) {
    const hoursSince = (now.getTime() - point.startDate.getTime()) / 3600000;
    if (hoursSince < 0) continue;
    totalDecayed += decay(point.load, hoursSince);
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

  // Normalise: raw 150 = extreme session (e.g. high RPE + high HR for 1hr with full suffer score)
  const score = Math.round(Math.min((totalDecayed / 150) * 100, 100));
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
