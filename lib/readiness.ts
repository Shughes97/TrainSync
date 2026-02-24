/**
 * Readiness model — computes a 0–100 daily readiness score.
 *
 * Uses enriched sessions (session:YYYY-MM-DD) where available,
 * falling back to raw Strava suffer_score data. Factors in:
 *  - Acute Training Load (7-day rolling average of intensity scores)
 *  - Consecutive neuromuscular penalty (two high-intensity strength days)
 */

import { getActivities, getEnrichedSession } from "./kv";
import type { ReadinessOutput } from "@/types";

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function computeReadiness(): Promise<ReadinessOutput> {
  const activities = await getActivities();

  // Build last 7 days in order (oldest first)
  const today = new Date();
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(isoDate(d));
  }

  // Load enriched sessions for all 7 days in parallel
  const enrichedSessions = await Promise.all(
    days.map((date) => getEnrichedSession(date))
  );

  // Build daily load scores
  const dailyLoads: number[] = days.map((date, idx) => {
    const enriched = enrichedSessions[idx];
    if (enriched?.enrichedIntensity != null) {
      return enriched.enrichedIntensity;
    }
    // Fall back to raw Strava suffer_score / 10
    const activity = activities.find((a) => a.start_date.startsWith(date));
    if (activity?.suffer_score != null) {
      return Math.min(activity.suffer_score / 10, 10);
    }
    return 0;
  });

  const atl = dailyLoads.reduce((sum, v) => sum + v, 0) / 7;

  // Consecutive neuromuscular penalty: last 2 days both neuromuscular, intensity > 7
  const lastTwo = enrichedSessions.slice(-2);
  const consecutiveNeuromuscularPenalty =
    lastTwo.length === 2 &&
    lastTwo.every(
      (s) =>
        s?.dominantStressType === "neuromuscular" &&
        (s?.enrichedIntensity ?? 0) > 7
    );

  let score = Math.round(100 - atl * 8);
  if (consecutiveNeuromuscularPenalty) score -= 10;
  score = Math.max(0, Math.min(100, score));

  // Build lastSessionSummary
  let lastSessionSummary = "No recent sessions found.";
  // Walk backwards through days to find the most recent with data
  for (let i = enrichedSessions.length - 1; i >= 0; i--) {
    const s = enrichedSessions[i];
    const date = days[i];
    const daysAgo = enrichedSessions.length - 1 - i;
    const whenLabel =
      daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`;

    if (s?.wod) {
      const load = s.wod.overallLoad.replace("_", " ");
      const type = s.wod.sessionType.replace(/_/g, " ");
      const intensity = s.enrichedIntensity ?? "?";
      lastSessionSummary = `${whenLabel}: ${s.wod.box ?? "CrossFit"} — ${type}, ${load} load (${intensity}/10).`;
      if (consecutiveNeuromuscularPenalty && daysAgo <= 1) {
        lastSessionSummary += " Back-to-back heavy sessions — allow extra recovery today.";
      }
      break;
    }

    if (s?.performance) {
      const intensity = s.enrichedIntensity ?? "?";
      const mins = s.performance.duration;
      lastSessionSummary = `${whenLabel}: ${mins}min gym session (${intensity}/10).`;
      break;
    }

    // Fall back to raw Strava
    const activity = activities.find((a) => a.start_date.startsWith(date));
    if (activity) {
      const suffer = activity.suffer_score ?? "–";
      lastSessionSummary = `${whenLabel}: ${activity.name} (effort ${suffer}).`;
      break;
    }
  }

  return { score, atl: Math.round(atl * 10) / 10, lastSessionSummary, consecutiveNeuromuscularPenalty };
}
