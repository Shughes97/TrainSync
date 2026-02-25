/**
 * Fatigue aggregator — computes a full FatigueSnapshot from all available data.
 *
 * Calls all three fatigue modules, applies weights, and generates the overall
 * verdict and recommendation.
 */

import { getActivities, getAthleteProfile, getRecentEnrichedSessions } from "@/lib/kv";
import { kv } from "@/lib/kv";
import { computeNeuromuscularFatigue } from "./neuromuscular";
import { computeCardiovascularFatigue } from "./cardiovascular";
import { computeMetabolicFatigue } from "./metabolic";
import type { FatigueSnapshot } from "@/types";

export type { FatigueSnapshot };

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadHistory(system: "neuromuscular" | "cardiovascular" | "metabolic"): Promise<number[]> {
  const history: number[] = [];
  const today = new Date();
  for (let i = 6; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    try {
      const val = await kv.get<number>(`fatigue:${system}:${isoDate(d)}`);
      history.push(val ?? 0);
    } catch {
      history.push(0);
    }
  }
  return history;
}

function buildRecommendation(
  overallScore: number,
  neuroScore: number,
  cardioScore: number,
  metabolicScore: number
): string {
  if (overallScore >= 80) {
    return "You're fresh across all systems. Today is a great day to push hard.";
  }
  if (overallScore >= 60) {
    const highest = Math.max(neuroScore, cardioScore, metabolicScore);
    if (highest === neuroScore && neuroScore > cardioScore && neuroScore > metabolicScore) {
      return "Your muscles need more time. Good day for a run or bike — avoid heavy lifting.";
    }
    if (highest === cardioScore && cardioScore > neuroScore && cardioScore > metabolicScore) {
      return "Aerobic system still recovering. Strength work is fine — keep the HR low.";
    }
    return "Your body is still processing recent high-intensity work. Zone 2 or rest today.";
  }
  if (overallScore >= 40) {
    return "Training today is ok but keep it controlled. No PRs, no max efforts.";
  }
  return "Rest or very light movement only. Pushing today risks a deeper hole.";
}

function buildVerdict(score: number): {
  verdict: FatigueSnapshot["overall"]["verdict"];
  verdictEmoji: FatigueSnapshot["overall"]["verdictEmoji"];
} {
  if (score >= 80) return { verdict: "ready", verdictEmoji: "🟢" };
  if (score >= 60) return { verdict: "moderate", verdictEmoji: "🟡" };
  if (score >= 40) return { verdict: "caution", verdictEmoji: "🟠" };
  return { verdict: "recover", verdictEmoji: "🔴" };
}

export async function computeFatigueSnapshot(now?: Date): Promise<FatigueSnapshot> {
  const today = now ?? new Date();
  const dateStr = isoDate(today);

  // Load data in parallel
  const [sessions, activities, athleteProfile, neuroHistory, cardioHistory, metabolicHistory] =
    await Promise.all([
      getRecentEnrichedSessions(14),
      getActivities(),
      getAthleteProfile(),
      loadHistory("neuromuscular"),
      loadHistory("cardiovascular"),
      loadHistory("metabolic"),
    ]);

  // Compute metabolic first (needed for neuromuscular half-life extension)
  const metabolicState = computeMetabolicFatigue(
    sessions, activities, athleteProfile, today, metabolicHistory
  );

  // Compute neuromuscular with metabolic fatigue score for variable half-life
  const neuromuscularState = computeNeuromuscularFatigue(
    sessions, activities, today, metabolicState.score, neuroHistory
  );

  const cardiovascularState = computeCardiovascularFatigue(
    sessions, activities, athleteProfile, today, cardioHistory
  );

  // Overall: neuro 35%, cardio 35%, metabolic 30%
  const overallScore = Math.round(
    neuromuscularState.score * 0.35 +
    cardiovascularState.score * 0.35 +
    metabolicState.score * 0.30
  );

  // Invert: overall is "readiness" — higher is BETTER
  // But fatigue scores are "higher = more fatigued", so readiness = 100 - fatigue
  const readinessScore = 100 - overallScore;

  const { verdict, verdictEmoji } = buildVerdict(readinessScore);
  const recommendation = buildRecommendation(
    readinessScore,
    neuromuscularState.score,
    cardiovascularState.score,
    metabolicState.score
  );

  // HRV estimate from resting HR (lower resting HR = higher HRV proxy)
  const restingHR = athleteProfile?.restingHR;
  const hrvScore =
    restingHR != null
      ? Math.round(Math.max(0, Math.min(100, (80 - restingHR) * 2.5)))
      : null;

  return {
    date: dateStr,
    neuromuscular: neuromuscularState,
    cardiovascular: cardiovascularState,
    metabolic: metabolicState,
    overall: {
      score: readinessScore,
      verdict,
      verdictEmoji,
      recommendation,
      sleepScore: null,
      hrvScore,
    },
  };
}
