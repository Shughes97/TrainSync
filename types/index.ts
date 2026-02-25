export type WorkoutType = "Crossfit" | "Strength" | "Run" | "Bike";

export interface WorkoutSession {
  id: string;
  type: WorkoutType;
  day: string; // ISO date string YYYY-MM-DD
  startTime: string; // HH:MM 24h
  endTime: string; // HH:MM 24h
  startISO: string; // full ISO string
  endISO: string; // full ISO string
  window: "morning" | "evening";
  /** Strength-specific workout suggestion, attached at schedule time and written into the calendar event description */
  openGymSuggestion?: OpenGymSuggestion;
}

export interface WorkoutProposal {
  session: WorkoutSession;
  status: "pending" | "accepted" | "skipped";
  calendarEventId?: string;
}

export interface BusySlot {
  start: string;
  end: string;
}

export interface SchedulerOptions {
  busySlots: BusySlot[];
  weekStart: Date;
  /** Optional: days that already have hard sessions (Crossfit/Strength) */
  hardSessionDays?: string[];
  /** Optional: days that already have any scheduled workout — proposals will not be placed here */
  scheduledDays?: string[];
  /** Optional: fatigue score per day (0–10), future use */
  fatigueByDay?: Record<string, number>;
  /** Optional: override the default 5-session weekly plan template */
  weeklyPlan?: Array<{ type: WorkoutType; isHard: boolean }>;
}

export interface SchedulerResult {
  proposals: WorkoutProposal[];
  warnings: string[];
}

/** A real calendar event with title, for the day preview timeline */
export interface CalEvent {
  id: string;
  summary: string;
  start: string; // ISO datetime (not all-day events)
  end: string;
}

/** Events grouped by ISO date string (YYYY-MM-DD) */
export type CalEventsByDay = Record<string, CalEvent[]>;

// ─── Training Plan Types ───────────────────────────────────────────────────────

export type PhaseType =
  | "endurance_base"
  | "peak_endurance"
  | "taper"
  | "event"
  | "hypertrophy";

export interface Goal {
  id: string;
  label: string;
  date: string; // YYYY-MM-DD
  type: "endurance_event" | "physique" | "strength" | "other";
  emoji: string;
}

export interface TrainingPhase {
  name: string;
  startWeek: number;
  endWeek: number;
  focus: PhaseType;
  emoji: string;
  longRideTargetKm: number;
  weeklyFocusNote: string;
  weeklyPlan: Array<{ type: WorkoutType; isHard: boolean }>;
}

export interface PhaseContext {
  phase: TrainingPhase;
  trainingWeek: number;
  weekInPhase: number;
  weeksInPhase: number;
}

export interface OpenGymExercise {
  name: string;
  sets: string;
}

export interface OpenGymSuggestion {
  focus: string;
  exercises: OpenGymExercise[];
  note: string;
}

// ─── Wodify + Session Enrichment Types ────────────────────────────────────────

export interface WodifySection {
  type: "warmup" | "weightlifting" | "metcon" | "skill" | "cooldown";
  name: string;
  description: string;
  movements: string[];
  dominantMuscleGroups: string[];
  estimatedIntensity: "low" | "moderate" | "high" | "very_high";
  coachingNotes: string;
}

export interface WodifyParsed {
  date: string; // YYYY-MM-DD
  box: string;
  sections: WodifySection[];
  sessionType: "strength_only" | "metcon_only" | "strength_and_metcon" | "skill" | "endurance";
  overallLoad: "low" | "moderate" | "high" | "very_high";
}

export interface EnrichedSession {
  date: string;
  source: "wodify+strava" | "wodify_pending" | "strava_only" | "prescribed+strava";
  pendingMatch?: boolean;
  wod?: {
    sections: WodifySection[];
    sessionType: string;
    overallLoad: string;
    box: string;
  };
  performance?: {
    stravaActivityId: number;
    duration: number;        // minutes
    averageHR: number | null;
    maxHR: number | null;
    sufferScore: number | null;
    calories: number | null;
  };
  enrichedIntensity?: number;      // 1–10
  dominantStressType?: "cardiovascular" | "neuromuscular" | "mixed";
  neuromuscularLoad?: number;      // 0–100 normalised
  sessionNotes?: { raw: string; parsed: ParsedSessionNotes };
  newPersonalBests?: PersonalBest[];
}

// ─── Fatigue + Readiness Types ────────────────────────────────────────────────

export interface FatigueSystemState {
  score: number;                       // 0–100, higher = more fatigued
  freshness: number;                   // 100 - score
  trend: "improving" | "stable" | "worsening";
  lastHardSessionHours: number;
  estimatedRecoveryHours: number;      // hours until score drops below 40
  primaryDriver: string;
  history: number[];                   // last 7 days scores, oldest first
}

// ─── Sleep Types ───────────────────────────────────────────────────────────────

export interface SleepEntry {
  date: string;          // YYYY-MM-DD — morning date (the day you woke up)
  hours: number;         // total hours asleep
  asleepMins: number;
  deepMins: number | null;
  remMins: number | null;
  source: "shortcut" | "manual";
  createdAt: string;     // ISO timestamp
}

export interface SleepState {
  lastNight: SleepEntry | null;
  lastNightScore: number | null;       // 0–100
  rolling3DayAvgHours: number | null;
  rolling3DayScore: number | null;     // 0–100
  rolling7DayAvgHours: number | null;
  rolling7DayScore: number | null;     // 0–100
  overallSleepScore: number | null;    // lastNight×50% + 3day×30% + 7day×20%
  trend: "improving" | "stable" | "worsening";
  history: (number | null)[];          // last 7 nights hours, oldest first
}

export interface FatigueSnapshot {
  date: string;                        // YYYY-MM-DD
  neuromuscular: FatigueSystemState;
  cardiovascular: FatigueSystemState;
  metabolic: FatigueSystemState;
  sleep: SleepState;
  overall: {
    score: number;                     // weighted across all systems
    verdict: "ready" | "moderate" | "caution" | "recover";
    verdictEmoji: "🟢" | "🟡" | "🟠" | "🔴";
    recommendation: string;
    sleepScore: number | null;         // = sleep.overallSleepScore
    hrvScore: number | null;           // estimated from restingHR
  };
}

// ─── Athlete Profile Types ─────────────────────────────────────────────────────

export type LiftKey =
  | "frontSquat"
  | "backSquat"
  | "deadlift"
  | "clean"
  | "snatch"
  | "benchPress"
  | "strictPress";

export type OneRepMaxes = Record<LiftKey, number | null>;

export interface OneRepMaxEntry {
  lift: string;
  estimatedMax: number;
  date: string;             // YYYY-MM-DD
  source: "manual" | "session_log" | "auto_calculated";
  notes: string;
}

export interface PersonalBest {
  lift: string;
  weight: number;           // kg
  reps: number;
  date: string;             // YYYY-MM-DD
  sessionId: string;
}

export interface LiftData {
  lift: string;             // camelCase LiftKey
  topSetWeight: number;     // kg
  topSetReps: number;
  estimatedOneRM: number | null;
  rpe: number | null;
}

export interface ParsedSessionNotes {
  liftData: LiftData[];
  metconNotes: {
    weight: number | null;
    scaling: string | null;
    feeling: string | null;
  };
  sessionRPE: number | null;
  sentiment: "positive" | "neutral" | "negative";
  injuryFlag: boolean;
  injuryNotes: string | null;
}

export interface AthleteProfile {
  name: string;
  age: number | null;
  height: number | null;            // cm
  weight: number | null;            // kg
  maxHR: number | null;
  maxHRSource?: "manual" | "strava_auto";
  restingHR: number | null;
  trainingAge: "1-2 years" | "3-5 years" | "5+ years" | null;
  oneRepMaxes: OneRepMaxes;
  oneRepMaxHistory: OneRepMaxEntry[];
  personalBests: PersonalBest[];
  goals: Goal[];
  preferredWorkoutWindows: string[];
  weightUnit: "kg";
}
