/**
 * Session Matcher — merges Wodify WOD data with Strava performance data.
 *
 * matchAndEnrichSession(date): loads Wodify parse + Strava activities for a date,
 * computes enrichedIntensity + dominantStressType, stores result in KV.
 *
 * resolvePendingSessions(): called after each Strava sync to complete any
 * sessions that were uploaded before the class synced to Strava.
 */

import { kv } from "@vercel/kv";
import {
  getWodifyData,
  getActivities,
  setEnrichedSession,
} from "./kv";
import type { EnrichedSession } from "@/types";

const GYM_STRAVA_TYPES = new Set(["WeightTraining", "Crossfit", "Workout"]);
const DEFAULT_MAX_HR = 190;

// ─── Intensity helpers ────────────────────────────────────────────────────────

const LOAD_BASE: Record<string, number> = {
  low: 3,
  moderate: 5,
  high: 7,
  very_high: 9,
};

function computeEnrichedIntensity(
  overallLoad: string,
  averageHR: number | null,
  sufferScore: number | null
): number {
  let score = LOAD_BASE[overallLoad] ?? 5;

  if (averageHR != null) {
    const pct = averageHR / DEFAULT_MAX_HR;
    if (pct > 0.9) score += 2;
    else if (pct > 0.8) score += 1;
  }

  if (sufferScore != null && sufferScore > 100) score += 1;

  return Math.min(score, 10);
}

function computeDominantStressType(
  sessionType: string
): EnrichedSession["dominantStressType"] {
  if (sessionType === "metcon_only" || sessionType === "endurance") return "cardiovascular";
  if (sessionType === "strength_only") return "neuromuscular";
  if (sessionType === "strength_and_metcon") return "mixed";
  return "mixed";
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function matchAndEnrichSession(date: string): Promise<EnrichedSession> {
  const [wodify, activities] = await Promise.all([
    getWodifyData(date),
    getActivities(),
  ]);

  const stravaActivity = activities.find(
    (a) => a.start_date.startsWith(date) && GYM_STRAVA_TYPES.has(a.type)
  );

  let result: EnrichedSession;

  if (wodify && stravaActivity) {
    const intensity = computeEnrichedIntensity(
      wodify.overallLoad,
      stravaActivity.average_heartrate,
      stravaActivity.suffer_score
    );
    result = {
      date,
      source: "wodify+strava",
      pendingMatch: false,
      wod: {
        sections: wodify.sections,
        sessionType: wodify.sessionType,
        overallLoad: wodify.overallLoad,
        box: wodify.box,
      },
      performance: {
        stravaActivityId: stravaActivity.id,
        duration: Math.round(stravaActivity.moving_time / 60),
        averageHR: stravaActivity.average_heartrate,
        maxHR: stravaActivity.max_heartrate,
        sufferScore: stravaActivity.suffer_score,
        calories: stravaActivity.calories,
      },
      enrichedIntensity: intensity,
      dominantStressType: computeDominantStressType(wodify.sessionType),
    };
  } else if (wodify && !stravaActivity) {
    result = {
      date,
      source: "wodify_pending",
      pendingMatch: true,
      wod: {
        sections: wodify.sections,
        sessionType: wodify.sessionType,
        overallLoad: wodify.overallLoad,
        box: wodify.box,
      },
      enrichedIntensity: LOAD_BASE[wodify.overallLoad] ?? 5,
      dominantStressType: computeDominantStressType(wodify.sessionType),
    };
  } else if (!wodify && stravaActivity) {
    const intensity = Math.min(
      Math.round((stravaActivity.suffer_score ?? 50) / 10),
      10
    );
    result = {
      date,
      source: "strava_only",
      performance: {
        stravaActivityId: stravaActivity.id,
        duration: Math.round(stravaActivity.moving_time / 60),
        averageHR: stravaActivity.average_heartrate,
        maxHR: stravaActivity.max_heartrate,
        sufferScore: stravaActivity.suffer_score,
        calories: stravaActivity.calories,
      },
      enrichedIntensity: intensity,
      dominantStressType: "mixed",
    };
  } else {
    // No data at all — return empty placeholder
    result = { date, source: "wodify_pending", pendingMatch: false };
  }

  await setEnrichedSession(date, result);
  return result;
}

// ─── Pending resolution (called after Strava sync) ───────────────────────────

export async function resolvePendingSessions(): Promise<void> {
  try {
    // Scan for all session:* keys
    const [, keys] = await kv.scan(0, { match: "session:*", count: 100 });
    if (!keys || keys.length === 0) return;

    for (const key of keys) {
      try {
        const session = await kv.get<EnrichedSession>(key);
        if (!session?.pendingMatch) continue;
        const date = (key as string).replace("session:", "");
        await matchAndEnrichSession(date);
      } catch {
        // skip individual failures silently
      }
    }
  } catch {
    // silently ignore if KV unavailable
  }
}
