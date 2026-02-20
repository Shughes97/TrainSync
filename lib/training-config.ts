/**
 * TrainSync — Goal & Periodisation Configuration
 *
 * All training phases, goals, and open-gym suggestions live here.
 * Week 1 = Feb 16 2026 (current week). Event Week (week 12) contains
 * the 100-mile ride on May 8 2026. Physique Block runs through Jun 14,
 * one day before the holiday on Jun 15.
 */

import type {
  Goal,
  OpenGymSuggestion,
  PhaseContext,
  TrainingPhase,
} from "@/types";

// ─── Plan Anchor ──────────────────────────────────────────────────────────────

/**
 * Monday of the first training week.
 * All phase week numbers are relative to this date.
 * Using T12:00:00 (noon) avoids DST edge cases in week arithmetic.
 */
export const PLAN_START = new Date("2026-02-16T12:00:00");

// ─── Goals ────────────────────────────────────────────────────────────────────

export const GOALS: Goal[] = [
  {
    id: "century_ride",
    label: "100 Mile Ride",
    date: "2026-05-08",
    type: "endurance_event",
    emoji: "🚴",
  },
  {
    id: "holiday",
    label: "Holiday",
    date: "2026-06-15",
    type: "physique",
    emoji: "🏖️",
  },
];

// ─── Training Phases ──────────────────────────────────────────────────────────
//
// Week 12 = May 4–10  (contains May 8 ride ✓)
// Week 17 = Jun 8–14  (physique block ends one day before Jun 15 holiday ✓)

export const TRAINING_PHASES: TrainingPhase[] = [
  {
    name: "Base Build",
    startWeek: 1,
    endWeek: 4,
    focus: "endurance_base",
    emoji: "🏗️",
    longRideTargetKm: 121,
    weeklyFocusNote:
      "Build your aerobic base. Work up to 121 km on the long ride by end of this phase.",
    weeklyPlan: [
      { type: "Bike", isHard: false },
      { type: "Crossfit", isHard: true },
      { type: "Crossfit", isHard: true },
      { type: "Strength", isHard: false },
      { type: "Run", isHard: false },
    ],
  },
  {
    name: "Peak Load",
    startWeek: 5,
    endWeek: 8,
    focus: "peak_endurance",
    emoji: "⚡",
    longRideTargetKm: 145,
    weeklyFocusNote:
      "Push your limits. Target a 135–145 km ride this weekend.",
    weeklyPlan: [
      { type: "Bike", isHard: false },
      { type: "Crossfit", isHard: true },
      { type: "Crossfit", isHard: true },
      { type: "Strength", isHard: false },
      { type: "Run", isHard: false },
    ],
  },
  {
    name: "Taper",
    startWeek: 9,
    endWeek: 11,
    focus: "taper",
    emoji: "🎯",
    longRideTargetKm: 97,
    weeklyFocusNote:
      "Back off the volume. Keep sessions short and sharp. Max 97 km on the bike.",
    weeklyPlan: [
      { type: "Bike", isHard: false },
      { type: "Crossfit", isHard: true },
      { type: "Run", isHard: false },
    ],
  },
  {
    name: "Event Week",
    startWeek: 12,
    endWeek: 12,
    focus: "event",
    emoji: "🏆",
    longRideTargetKm: 161,
    weeklyFocusNote:
      "Race week! Stay loose and trust your training. The 161 km ride is this weekend.",
    weeklyPlan: [
      { type: "Crossfit", isHard: false },
      { type: "Run", isHard: false },
    ],
  },
  {
    name: "Physique Block",
    startWeek: 13,
    endWeek: 17,
    focus: "hypertrophy",
    emoji: "💪",
    longRideTargetKm: 64,
    weeklyFocusNote:
      "Century done! Build visible muscle with a push/pull/legs split. Short maintenance rides only.",
    weeklyPlan: [
      { type: "Strength", isHard: false },
      { type: "Strength", isHard: false },
      { type: "Strength", isHard: false },
      { type: "Crossfit", isHard: true },
      { type: "Crossfit", isHard: true },
    ],
  },
];

// ─── Phase Helpers ────────────────────────────────────────────────────────────

/** Returns the 1-based training week number for a given date. */
export function getTrainingWeek(from: Date = new Date()): number {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.floor((from.getTime() - PLAN_START.getTime()) / msPerWeek) + 1;
}

/** Returns the current phase context, or null if outside the 17-week window. */
export function getCurrentPhase(from: Date = new Date()): PhaseContext | null {
  const week = getTrainingWeek(from);
  const phase = TRAINING_PHASES.find(
    (p) => week >= p.startWeek && week <= p.endWeek
  );
  if (!phase) return null;
  return {
    phase,
    trainingWeek: week,
    weekInPhase: week - phase.startWeek + 1,
    weeksInPhase: phase.endWeek - phase.startWeek + 1,
  };
}

/** Returns whole days until the given goal date (negative once past). */
export function daysUntilGoal(goalDate: string, from: Date = new Date()): number {
  const target = new Date(goalDate + "T12:00:00");
  return Math.ceil((target.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Open Gym Suggestions ─────────────────────────────────────────────────────

export const OPEN_GYM_SUGGESTIONS: Record<string, OpenGymSuggestion> = {
  endurance_base: {
    focus: "Posterior Chain",
    exercises: [
      { name: "Romanian Deadlifts", sets: "4×8" },
      { name: "Bulgarian Split Squats", sets: "3×10 each leg" },
      { name: "Hip Thrusts", sets: "3×12" },
      { name: "Single-Leg Press", sets: "3×10" },
    ],
    note: "Supporting cycling performance and building base strength.",
  },
  peak_endurance: {
    focus: "Strength Maintenance",
    exercises: [
      { name: "Deadlifts", sets: "4×5 heavy" },
      { name: "Front Squats", sets: "3×6" },
      { name: "Single-Leg RDL", sets: "3×8 each leg" },
    ],
    note: "Maintaining strength without accumulating fatigue before the ride.",
  },
  taper: {
    focus: "Activation Only",
    exercises: [
      { name: "Glute Bridges", sets: "2×15" },
      { name: "Banded Clamshells", sets: "2×20 each side" },
      { name: "Light Goblet Squat", sets: "2×12" },
    ],
    note: "Keep muscles awake. Nothing heavy this close to the ride.",
  },
  event: {
    focus: "Activation Only",
    exercises: [
      { name: "Glute Bridges", sets: "2×15" },
      { name: "Light Box Step-ups", sets: "2×10 each leg" },
    ],
    note: "Race week — stay loose. Keep it very short and easy.",
  },
  hypertrophy_a: {
    focus: "Push — Chest & Shoulders",
    exercises: [
      { name: "Bench Press", sets: "4×10" },
      { name: "DB Shoulder Press", sets: "3×12" },
      { name: "Tricep Dips", sets: "3×12" },
    ],
    note: "Push session. Full range of motion, controlled 2-second lowering.",
  },
  hypertrophy_b: {
    focus: "Pull — Back & Biceps",
    exercises: [
      { name: "Barbell Rows", sets: "4×10" },
      { name: "Pull-ups", sets: "3×10" },
      { name: "Bicep Curls", sets: "3×12" },
    ],
    note: "Pull session. Squeeze hard at the top of each rep.",
  },
  hypertrophy_c: {
    focus: "Legs",
    exercises: [
      { name: "Squats", sets: "4×10" },
      { name: "Lunges", sets: "3×12 each leg" },
      { name: "Leg Curl", sets: "3×12" },
    ],
    note: "Leg session. Different stimulus from CrossFit-style conditioning.",
  },
};

/**
 * Returns the right open-gym suggestion for the current phase focus.
 * For hypertrophy, rotates A/B/C based on which strength session this is
 * (0-indexed within the week — so first Strength = Push, second = Pull, third = Legs).
 */
export function getOpenGymSuggestion(
  focus: string,
  strengthSessionIndex: number = 0
): OpenGymSuggestion | null {
  if (focus === "hypertrophy") {
    const keys = ["hypertrophy_a", "hypertrophy_b", "hypertrophy_c"] as const;
    return OPEN_GYM_SUGGESTIONS[keys[strengthSessionIndex % 3]] ?? null;
  }
  return OPEN_GYM_SUGGESTIONS[focus] ?? null;
}
