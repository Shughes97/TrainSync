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
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
  },
  Strength: {
    icon: "💪",
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  Run: {
    icon: "🏃",
    color: "text-green-600",
    bg: "bg-green-50",
    border: "border-green-200",
  },
  Bike: {
    icon: "🚴",
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
};

const statusBadge: Record<
  WorkoutProposal["status"],
  { label: string; classes: string }
> = {
  pending: { label: "Pending", classes: "bg-gray-100 text-gray-600" },
  accepted: { label: "Accepted", classes: "bg-green-100 text-green-700" },
  skipped: { label: "Skipped", classes: "bg-gray-100 text-gray-400 line-through" },
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
      className={`rounded-2xl border p-4 transition-all duration-200 shadow-sm ${config.bg} ${config.border} ${isSkipped ? "opacity-40" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{config.icon}</span>
          <div>
            <h3 className={`font-semibold text-base ${config.color}`}>
              {session.type}
            </h3>
            <p className="text-xs text-gray-500 capitalize">{session.window} session</p>
          </div>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.classes}`}>
          {badge.label}
        </span>
      </div>

      {/* Time details */}
      <div className="mb-3 space-y-1">
        <p className="text-sm text-gray-800 font-medium">{formatDay(session.day)}</p>
        <p className="text-sm text-gray-500">
          {formatTime(session.startTime)} — {formatTime(session.endTime)}
        </p>
      </div>

      {/* Day preview timeline */}
      {!isSkipped && <DayPreview session={session} events={dayEvents} />}

      {/* Open Gym workout suggestion */}
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
                  className="flex-1 py-2 rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium transition-colors"
                >
                  Accept
                </button>
                <button
                  onClick={() => onChangeTime(session.id)}
                  className="flex-1 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-sm font-medium transition-colors"
                >
                  Change Time
                </button>
                <button
                  onClick={() => onSkip(session.id)}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-red-50 border border-gray-200 hover:border-red-200 text-gray-500 hover:text-red-500 text-sm transition-colors"
                >
                  Skip
                </button>
              </>
            )}
            {status === "accepted" && (
              <>
                <button
                  onClick={() => onSkip(session.id)}
                  className="flex-1 py-2 rounded-xl bg-white hover:bg-red-50 border border-gray-200 hover:border-red-200 text-gray-500 hover:text-red-500 text-sm font-medium transition-colors"
                >
                  Remove
                </button>
                <button
                  onClick={() => onChangeTime(session.id)}
                  className="flex-1 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-sm font-medium transition-colors"
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
            className="w-full py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 text-sm font-medium transition-colors"
          >
            Restore
          </button>
        )}
      </div>
    </div>
  );
}
