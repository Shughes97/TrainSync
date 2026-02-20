"use client";

import Link from "next/link";
import type { PhaseContext, WorkoutProposal, WorkoutType } from "@/types";

interface WeekFocusCardProps {
  phaseContext: PhaseContext | null;
  proposals: WorkoutProposal[];
  daysUntilCentury: number;
  daysUntilHoliday: number;
}

const SESSION_ICONS: Record<WorkoutType, string> = {
  Crossfit: "🏋️",
  Strength: "💪",
  Run: "🏃",
  Bike: "🚴",
};

export default function WeekFocusCard({
  phaseContext,
  proposals,
  daysUntilCentury,
  daysUntilHoliday,
}: WeekFocusCardProps) {
  if (!phaseContext) return null;

  const { phase, weekInPhase, weeksInPhase } = phaseContext;
  const progressPct = ((weekInPhase - 1) / weeksInPhase) * 100;

  const weeksUntilCentury = Math.ceil(daysUntilCentury / 7);
  const weeksUntilHoliday = Math.ceil(daysUntilHoliday / 7);

  // Build per-slot status tracker. For phases with multiple sessions of the
  // same type (e.g. 3× Strength) track each slot individually.
  const proposalsByType: Record<string, WorkoutProposal[]> = {};
  for (const p of proposals) {
    const key = p.session.type;
    if (!proposalsByType[key]) proposalsByType[key] = [];
    proposalsByType[key].push(p);
  }

  const displaySlots = phase.weeklyPlan.map((slot, i) => {
    const positionInType = phase.weeklyPlan
      .slice(0, i + 1)
      .filter((s) => s.type === slot.type).length;
    const proposal = (proposalsByType[slot.type] ?? [])[positionInType - 1];
    return {
      type: slot.type,
      icon: SESSION_ICONS[slot.type],
      status: proposal?.status ?? "missing",
    };
  });

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
      {/* Phase header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{phase.emoji}</span>
          <div>
            <p className="text-sm font-semibold text-white">{phase.name}</p>
            <p className="text-xs text-zinc-400">
              Week {weekInPhase} of {weeksInPhase}
            </p>
          </div>
        </div>
        <Link
          href="/goals"
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          View plan →
        </Link>
      </div>

      {/* Phase progress bar */}
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(progressPct, 4)}%` }}
        />
      </div>

      {/* Weekly focus note */}
      <p className="text-sm text-zinc-300 leading-relaxed">
        {phase.weeklyFocusNote}
      </p>

      {/* Goal countdowns */}
      <div className="flex gap-2">
        {daysUntilCentury > 0 && (
          <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">
              🚴 Century Ride
            </p>
            <p className="text-base font-bold text-white">
              {weeksUntilCentury}w
            </p>
          </div>
        )}
        {daysUntilHoliday > 0 && (
          <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">
              🏖️ Holiday
            </p>
            <p className="text-base font-bold text-white">
              {weeksUntilHoliday}w
            </p>
          </div>
        )}
      </div>

      {/* 5-slot session tracker */}
      <div className="flex gap-1.5">
        {displaySlots.map((slot, i) => {
          const isActive = slot.status === "accepted" || slot.status === "pending";
          const isSkipped = slot.status === "skipped";
          return (
            <div
              key={i}
              title={slot.type}
              className={`flex-1 h-9 rounded-lg flex flex-col items-center justify-center gap-0.5 border transition-all ${
                isActive
                  ? "bg-indigo-600/20 border-indigo-500/40"
                  : isSkipped
                  ? "bg-zinc-800/20 border-zinc-700/30"
                  : "bg-zinc-800/40 border-zinc-700/30"
              }`}
            >
              <span
                className={`text-sm leading-none ${
                  isActive ? "opacity-100" : "opacity-25"
                }`}
              >
                {slot.icon}
              </span>
              {isSkipped && (
                <span className="text-[8px] text-zinc-600 leading-none">skip</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
