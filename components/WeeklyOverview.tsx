"use client";

import type { WorkoutProposal, WorkoutType } from "@/types";

interface WeeklyOverviewProps {
  proposals: WorkoutProposal[];
  scheduledEventCount: number;
}

const TARGET = 5;

const typeColors: Record<WorkoutType, string> = {
  Crossfit: "bg-orange-500",
  Strength: "bg-yellow-500",
  Run: "bg-green-500",
  Bike: "bg-blue-500",
};

const typeIcons: Record<WorkoutType, string> = {
  Crossfit: "🏋️",
  Strength: "💪",
  Run: "🏃",
  Bike: "🚴",
};

export default function WeeklyOverview({
  proposals,
  scheduledEventCount,
}: WeeklyOverviewProps) {
  const accepted = proposals.filter((p) => p.status === "accepted");
  const pending = proposals.filter((p) => p.status === "pending");
  const skipped = proposals.filter((p) => p.status === "skipped");

  const total = accepted.length + scheduledEventCount;
  const progressPct = Math.min(100, (total / TARGET) * 100);

  // Count by type
  const countByType = proposals.reduce<Record<string, number>>((acc, p) => {
    acc[p.session.type] = (acc[p.session.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <h2 className="text-base font-semibold text-white mb-4">Weekly Target</h2>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-zinc-400">
            {total} / {TARGET} sessions
          </span>
          <span
            className={`text-sm font-medium ${
              total >= TARGET ? "text-green-400" : "text-zinc-300"
            }`}
          >
            {total >= TARGET ? "On Track!" : `${TARGET - total} to go`}
          </span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              total >= TARGET ? "bg-green-500" : "bg-indigo-500"
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Session type breakdown */}
      <div className="space-y-2 mb-5">
        {(Object.entries(countByType) as [WorkoutType, number][]).map(
          ([type, count]) => (
            <div key={type} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${typeColors[type]}`} />
                <span className="text-sm text-zinc-300">
                  {typeIcons[type]} {type}
                </span>
              </div>
              <span className="text-sm text-zinc-400">×{count}</span>
            </div>
          )
        )}
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-800 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-white">{accepted.length}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Accepted</p>
        </div>
        <div className="bg-zinc-800 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-zinc-400">{pending.length}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Pending</p>
        </div>
        <div className="bg-zinc-800 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-red-400">{skipped.length}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Skipped</p>
        </div>
      </div>

      {scheduledEventCount > 0 && (
        <p className="mt-3 text-xs text-zinc-500 text-center">
          + {scheduledEventCount} already on calendar
        </p>
      )}
    </div>
  );
}
