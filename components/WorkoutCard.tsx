"use client";

import { formatDay, formatTime } from "@/lib/scheduler";
import type { CalEvent, OpenGymSuggestion, WorkoutProposal, WorkoutType } from "@/types";
import DayPreview from "./DayPreview";
import OpenGymCard from "./OpenGymCard";

interface WorkoutCardProps {
  proposal: WorkoutProposal;
  dayEvents: CalEvent[];
  openGymSuggestion?: OpenGymSuggestion | null;
  onAccept: (id: string) => void;
  onSkip: (id: string) => void;
  onChangeTime: (id: string) => void;
}

const workoutConfig: Record<
  WorkoutType,
  { icon: string; color: string; bg: string; border: string }
> = {
  Crossfit: {
    icon: "🏋️",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
  },
  Strength: {
    icon: "💪",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
  },
  Run: {
    icon: "🏃",
    color: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/30",
  },
  Bike: {
    icon: "🚴",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
};

const statusBadge: Record<
  WorkoutProposal["status"],
  { label: string; classes: string }
> = {
  pending: { label: "Pending", classes: "bg-zinc-700 text-zinc-300" },
  accepted: { label: "Accepted", classes: "bg-green-500/20 text-green-400" },
  skipped: { label: "Skipped", classes: "bg-zinc-800 text-zinc-500 line-through" },
};

export default function WorkoutCard({
  proposal,
  dayEvents,
  openGymSuggestion,
  onAccept,
  onSkip,
  onChangeTime,
}: WorkoutCardProps) {
  const { session, status } = proposal;
  const config = workoutConfig[session.type];
  const badge = statusBadge[status];
  const isSkipped = status === "skipped";

  return (
    <div
      className={`
        rounded-2xl border p-4 transition-all duration-200
        ${config.bg} ${config.border}
        ${isSkipped ? "opacity-40" : ""}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{config.icon}</span>
          <div>
            <h3 className={`font-semibold text-base ${config.color}`}>
              {session.type}
            </h3>
            <p className="text-xs text-zinc-400 capitalize">{session.window} session</p>
          </div>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.classes}`}
        >
          {badge.label}
        </span>
      </div>

      {/* Time details */}
      <div className="mb-3 space-y-1">
        <p className="text-sm text-zinc-200 font-medium">
          {formatDay(session.day)}
        </p>
        <p className="text-sm text-zinc-400">
          {formatTime(session.startTime)} — {formatTime(session.endTime)}
        </p>
      </div>

      {/* Day preview timeline */}
      {!isSkipped && (
        <DayPreview session={session} events={dayEvents} />
      )}

      {/* Open Gym workout suggestion (Strength sessions only) */}
      {!isSkipped && session.type === "Strength" && openGymSuggestion && (
        <OpenGymCard suggestion={openGymSuggestion} />
      )}

      {/* Actions */}
      <div className="mt-3">
        {!isSkipped && (
          <div className="flex gap-2">
            {status === "pending" && (
              <>
                <button
                  onClick={() => onAccept(session.id)}
                  className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
                >
                  Accept
                </button>
                <button
                  onClick={() => onChangeTime(session.id)}
                  className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium transition-colors"
                >
                  Change Time
                </button>
                <button
                  onClick={() => onSkip(session.id)}
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 text-sm transition-colors"
                >
                  Skip
                </button>
              </>
            )}
            {status === "accepted" && (
              <>
                <button
                  onClick={() => onSkip(session.id)}
                  className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 text-sm font-medium transition-colors"
                >
                  Remove
                </button>
                <button
                  onClick={() => onChangeTime(session.id)}
                  className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium transition-colors"
                >
                  Change Time
                </button>
              </>
            )}
          </div>
        )}
        {isSkipped && (
          <button
            onClick={() => onAccept(session.id)}
            className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 text-sm font-medium transition-colors"
          >
            Restore
          </button>
        )}
      </div>
    </div>
  );
}
