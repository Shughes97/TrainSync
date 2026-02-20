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
  type: "endurance_event" | "physique";
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
