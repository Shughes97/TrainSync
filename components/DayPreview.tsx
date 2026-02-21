"use client";

import type { CalEvent, WorkoutSession, WorkoutType } from "@/types";

interface DayPreviewProps {
  session: WorkoutSession;
  events: CalEvent[];
}

const WINDOW_CONTEXT = {
  morning:        { start: 6 * 60,        end: 9 * 60 + 30 },
  morningWeekend: { start: 7 * 60 + 30,  end: 13 * 60 },
  evening:        { start: 16 * 60,       end: 21 * 60 },
} as const;

const WORKOUT_COLORS: Record<WorkoutType, string> = {
  Crossfit: "bg-orange-500",
  Strength: "bg-amber-500",
  Run:      "bg-green-500",
  Bike:     "bg-blue-500",
};

function toMins(isoStr: string): number {
  const d = new Date(isoStr);
  return d.getHours() * 60 + d.getMinutes();
}

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return m > 0
    ? `${hour}:${String(m).padStart(2, "0")}${period}`
    : `${hour}${period}`;
}

function slotStyle(
  startMins: number,
  endMins: number,
  windowStart: number,
  windowDuration: number
): { left: string; width: string } {
  const clampedStart = Math.max(startMins, windowStart);
  const clampedEnd = Math.min(endMins, windowStart + windowDuration);
  const left = ((clampedStart - windowStart) / windowDuration) * 100;
  const width = Math.max(((clampedEnd - clampedStart) / windowDuration) * 100, 2);
  return { left: `${left}%`, width: `${width}%` };
}

export default function DayPreview({ session, events }: DayPreviewProps) {
  const dow = new Date(session.day + "T12:00:00").getDay();
  const isWeekend = dow === 0 || dow === 6;
  const ctxKey =
    session.window === "morning" && isWeekend ? "morningWeekend" : session.window;
  const ctx = WINDOW_CONTEXT[ctxKey];
  const windowStart = ctx.start;
  const windowEnd = ctx.end;
  const windowDuration = windowEnd - windowStart;

  const workoutStartMins = toMins(session.startISO);
  const workoutEndMins = workoutStartMins + 60;

  const relevantEvents = events.filter((evt) => {
    const eStart = toMins(evt.start);
    const eEnd = toMins(evt.end);
    return eStart < windowEnd && eEnd > windowStart;
  });

  const workoutStyle = slotStyle(workoutStartMins, workoutEndMins, windowStart, windowDuration);
  const workoutColorClass = WORKOUT_COLORS[session.type];

  const ticks: number[] = [];
  const firstHour = Math.ceil(windowStart / 60) * 60;
  for (let t = firstHour; t < windowEnd; t += 60) {
    ticks.push(t);
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 select-none">
      <div className="relative h-7 bg-gray-100 rounded-lg overflow-hidden">
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute top-0 bottom-0 w-px bg-gray-300/60"
            style={{ left: `${((t - windowStart) / windowDuration) * 100}%` }}
          />
        ))}

        {relevantEvents.map((evt) => {
          const eStart = toMins(evt.start);
          const eEnd = toMins(evt.end);
          const style = slotStyle(eStart, eEnd, windowStart, windowDuration);
          return (
            <div
              key={evt.id}
              className="absolute top-1 bottom-1 bg-gray-400/30 rounded flex items-center overflow-hidden px-1"
              style={style}
              title={evt.summary}
            >
              <span className="text-[9px] text-gray-600 truncate leading-none">
                {evt.summary}
              </span>
            </div>
          );
        })}

        <div
          className={`absolute top-0 bottom-0 ${workoutColorClass} opacity-80 rounded flex items-center justify-center overflow-hidden`}
          style={workoutStyle}
        >
          <span className="text-[9px] font-semibold text-white truncate px-1 leading-none">
            {session.type}
          </span>
        </div>
      </div>

      <div className="relative h-4 mt-0.5">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute text-[9px] text-gray-400 -translate-x-1/2"
            style={{ left: `${((t - windowStart) / windowDuration) * 100}%` }}
          >
            {fmtMins(t)}
          </span>
        ))}
        <span className="absolute right-0 text-[9px] text-gray-400">
          {fmtMins(windowEnd)}
        </span>
      </div>
    </div>
  );
}
