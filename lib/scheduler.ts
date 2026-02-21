/**
 * TrainSync Scheduling Engine
 *
 * Isolated scheduling logic. Pass in busy slots and options; get back
 * ranked workout proposals. Designed so fatigue/load data can be added
 * later via SchedulerOptions without restructuring.
 */

import type {
  BusySlot,
  SchedulerOptions,
  SchedulerResult,
  WorkoutProposal,
  WorkoutSession,
  WorkoutType,
} from "@/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const WORKOUT_WINDOWS = {
  weekday: {
    morning: { startMin: 390, endMin: 480 },   // 06:30–08:00
    evening: { startMin: 1020, endMin: 1200 },  // 17:00–20:00
  },
  weekend: {
    morning: { startMin: 480, endMin: 720 },    // 08:00–12:00
    evening: { startMin: 1020, endMin: 1200 },  // 17:00–20:00
  },
} as const;

const SESSION_DURATION_HOURS = 1;

/**
 * Travel buffer: minimum gap between a busy event and a workout.
 * Accounts for travel to/from the gym.
 */
const TRAVEL_BUFFER_MIN = 30;

/**
 * The 5-session weekly plan template.
 * Priority order controls how we assign slots when options are limited.
 */
const WEEKLY_PLAN: Array<{ type: WorkoutType; isHard: boolean }> = [
  { type: "Crossfit", isHard: true },
  { type: "Crossfit", isHard: true },
  { type: "Strength", isHard: false },
  { type: "Run", isHard: false },
  { type: "Bike", isHard: false },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad(h)}:${pad(m)}`;
}

function isoDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type SlotEntry = {
  startTime: string;
  endTime: string;
  startISO: string;
  endISO: string;
  window: "morning" | "evening";
  dayDate: Date;
};

/**
 * Finds all free 1-hour blocks within a time window on a given day.
 * windowStartMin / windowEndMin are in minutes from midnight.
 * Each busy slot is expanded by TRAVEL_BUFFER_MIN on each side so that
 * there's always 30 min travel time before/after any existing event.
 */
function findFreeBlocks(
  dayDate: Date,
  windowStartMin: number,
  windowEndMin: number,
  busySlots: BusySlot[]
): Array<Omit<SlotEntry, "window" | "dayDate">> {
  const blocks: Array<Omit<SlotEntry, "window" | "dayDate">> = [];
  const dayStr = isoDateStr(dayDate);

  const busy: Array<[number, number]> = busySlots
    .filter((slot) => {
      const slotDay = slot.start.substring(0, 10);
      const slotEndDay = slot.end.substring(0, 10);
      return slotDay === dayStr || slotEndDay === dayStr;
    })
    .map((slot) => {
      const startDate = new Date(slot.start);
      const endDate = new Date(slot.end);
      const startMin = startDate.getHours() * 60 + startDate.getMinutes();
      const endMin = endDate.getHours() * 60 + endDate.getMinutes();
      // Expand by travel buffer: need 30 min to reach gym before, 30 min home after
      return [startMin - TRAVEL_BUFFER_MIN, endMin + TRAVEL_BUFFER_MIN] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);

  const durationMin = SESSION_DURATION_HOURS * 60;

  for (
    let cursor = windowStartMin;
    cursor + durationMin <= windowEndMin;
    cursor += 30
  ) {
    const slotStart = cursor;
    const slotEnd = cursor + durationMin;

    const overlaps = busy.some(
      ([bStart, bEnd]) => slotStart < bEnd && slotEnd > bStart
    );

    if (!overlaps) {
      const startTime = fromMinutes(slotStart);
      const endTime = fromMinutes(slotEnd);
      blocks.push({
        startTime,
        endTime,
        startISO: `${dayStr}T${startTime}:00`,
        endISO: `${dayStr}T${endTime}:00`,
      });
    }
  }

  return blocks;
}

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Picks `count` days spread evenly across the full list of available days.
 * For 5 sessions across 7 days this naturally selects days like
 * Mon, Wed, Thu, Sat, Sun — including weekends — rather than front-loading
 * Mon–Fri just because they come first chronologically.
 */
function spreadSelect(days: string[], count: number): Set<string> {
  if (days.length <= count) return new Set(days);
  const selected = new Set<string>();
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (days.length - 1)) / (count - 1));
    selected.add(days[idx]);
  }
  return selected;
}

// ─── Main Scheduler ───────────────────────────────────────────────────────────

export function buildWeeklyPlan(options: SchedulerOptions): SchedulerResult {
  const { busySlots, weekStart, hardSessionDays = [] } = options;
  // Use the phase-specific plan if provided, otherwise fall back to the default.
  const plan = options.weeklyPlan ?? WEEKLY_PLAN;
  const warnings: string[] = [];

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push(d);
  }

  const availableByDay = new Map<string, SlotEntry[]>();

  for (const day of days) {
    const dayStr = isoDateStr(day);
    const slots: SlotEntry[] = [];

    const dow = day.getDay(); // 0 = Sun, 6 = Sat
    const windows = dow === 0 || dow === 6
      ? WORKOUT_WINDOWS.weekend
      : WORKOUT_WINDOWS.weekday;

    for (const [windowName, { startMin, endMin }] of Object.entries(windows) as [
      "morning" | "evening",
      { startMin: number; endMin: number }
    ][]) {
      const blocks = findFreeBlocks(day, startMin, endMin, busySlots);
      for (const block of blocks) {
        slots.push({ ...block, window: windowName, dayDate: day });
      }
    }

    if (slots.length > 0) {
      availableByDay.set(dayStr, slots);
    }
  }

  const proposals: WorkoutProposal[] = [];
  const usedDays = new Set<string>();
  const hardDays = new Set<string>(hardSessionDays);

  // Hard sessions first to get priority slot selection
  const sortedPlan = [...plan].sort((a, b) =>
    a.isHard === b.isHard ? 0 : a.isHard ? -1 : 1
  );

  // Pre-compute a spread of preferred days so sessions are distributed evenly
  // across all 7 days (Mon–Sun) rather than always filling Mon–Fri first.
  const chronoDays = Array.from(availableByDay.keys()).sort();
  const preferredDays = spreadSelect(chronoDays, plan.length);

  // Preferred days first, then remaining days as fallback — preserving
  // chronological order within each group so earlier slots still win ties.
  const orderedDayKeys = [
    ...chronoDays.filter((d) => preferredDays.has(d)),
    ...chronoDays.filter((d) => !preferredDays.has(d)),
  ];

  for (const workout of sortedPlan) {
    let assigned = false;
    const dayKeys = orderedDayKeys;

    // First pass: respect consecutive-day constraint for hard sessions
    for (const dayStr of dayKeys) {
      if (usedDays.has(dayStr)) continue;

      if (workout.isHard) {
        const dayDate = new Date(dayStr + "T12:00:00");
        const prevDay = new Date(dayDate);
        prevDay.setDate(prevDay.getDate() - 1);
        const nextDay = new Date(dayDate);
        nextDay.setDate(nextDay.getDate() + 1);

        if (
          hardDays.has(isoDateStr(prevDay)) ||
          hardDays.has(isoDateStr(nextDay))
        ) {
          continue;
        }
      }

      const slots = availableByDay.get(dayStr);
      if (!slots || slots.length === 0) continue;

      const slot = slots[0];
      const session: WorkoutSession = {
        id: generateId(),
        type: workout.type,
        day: dayStr,
        startTime: slot.startTime,
        endTime: slot.endTime,
        startISO: slot.startISO,
        endISO: slot.endISO,
        window: slot.window,
      };

      proposals.push({ session, status: "pending" });
      usedDays.add(dayStr);
      if (workout.isHard) hardDays.add(dayStr);
      assigned = true;
      break;
    }

    // Second pass for hard sessions: relax consecutive constraint
    if (!assigned && workout.isHard) {
      for (const dayStr of dayKeys) {
        if (usedDays.has(dayStr)) continue;
        const slots = availableByDay.get(dayStr);
        if (!slots || slots.length === 0) continue;

        const slot = slots[0];
        const session: WorkoutSession = {
          id: generateId(),
          type: workout.type,
          day: dayStr,
          startTime: slot.startTime,
          endTime: slot.endTime,
          startISO: slot.startISO,
          endISO: slot.endISO,
          window: slot.window,
        };

        proposals.push({ session, status: "pending" });
        usedDays.add(dayStr);
        hardDays.add(dayStr);
        warnings.push(
          `${workout.type} on ${dayStr} — back-to-back hard sessions could not be avoided.`
        );
        assigned = true;
        break;
      }
    }

    // Easy sessions fill remaining days
    if (!assigned && !workout.isHard) {
      for (const dayStr of dayKeys) {
        if (usedDays.has(dayStr)) continue;
        const slots = availableByDay.get(dayStr);
        if (!slots || slots.length === 0) continue;

        const slot = slots[0];
        const session: WorkoutSession = {
          id: generateId(),
          type: workout.type,
          day: dayStr,
          startTime: slot.startTime,
          endTime: slot.endTime,
          startISO: slot.startISO,
          endISO: slot.endISO,
          window: slot.window,
        };

        proposals.push({ session, status: "pending" });
        usedDays.add(dayStr);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      warnings.push(
        `No free slot found for ${workout.type} this week. Free up time in the 6:30–8am or 5–8pm windows.`
      );
    }
  }

  proposals.sort((a, b) => a.session.day.localeCompare(b.session.day));
  return { proposals, warnings };
}

/** Returns the Monday of the current week */
export function getWeekStart(from: Date = new Date()): Date {
  const d = new Date(from);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Format a day string for display */
export function formatDay(dayStr: string): string {
  const date = new Date(dayStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * Find all free 1-hour slots within the workout windows for a given day.
 * Used by the calendar-sync cron to pick a replacement slot after a conflict.
 */
export function findSlotsForDay(
  dayDate: Date,
  busySlots: BusySlot[]
): Array<{
  startTime: string;
  endTime: string;
  startISO: string;
  endISO: string;
  window: "morning" | "evening";
}> {
  const dow = dayDate.getDay();
  const windows =
    dow === 0 || dow === 6 ? WORKOUT_WINDOWS.weekend : WORKOUT_WINDOWS.weekday;
  const result: Array<{
    startTime: string;
    endTime: string;
    startISO: string;
    endISO: string;
    window: "morning" | "evening";
  }> = [];

  for (const [windowName, { startMin, endMin }] of Object.entries(windows) as [
    "morning" | "evening",
    { startMin: number; endMin: number }
  ][]) {
    const blocks = findFreeBlocks(dayDate, startMin, endMin, busySlots);
    for (const block of blocks) result.push({ ...block, window: windowName });
  }
  return result;
}

/** Format a time string for display */
export function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}
