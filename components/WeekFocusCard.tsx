"use client";

import Link from "next/link";
import { daysUntilGoal } from "@/lib/training-config";
import type { Goal, PhaseContext, WorkoutProposal, WorkoutType } from "@/types";

interface WeekFocusCardProps {
  phaseContext: PhaseContext | null;
  proposals: WorkoutProposal[];
  goals: Goal[];
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
  goals,
}: WeekFocusCardProps) {
  if (!phaseContext) return null;

  const { phase, weekInPhase, weeksInPhase } = phaseContext;
  const progressPct = ((weekInPhase - 1) / weeksInPhase) * 100;

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

  // Build countdown chips for upcoming goals only
  const upcomingGoals = goals
    .map((g) => ({ ...g, days: daysUntilGoal(g.date) }))
    .filter((g) => g.days > 0)
    .sort((a, b) => a.days - b.days)
    .slice(0, 3); // show up to 3 upcoming goals

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3 shadow-sm">
      {/* Phase header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{phase.emoji}</span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{phase.name}</p>
            <p className="text-xs text-gray-500">
              Week {weekInPhase} of {weeksInPhase}
            </p>
          </div>
        </div>
        <Link
          href="/goals"
          className="text-xs text-indigo-600 hover:text-indigo-700 transition-colors"
        >
          View plan →
        </Link>
      </div>

      {/* Phase progress bar */}
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(progressPct, 4)}%` }}
        />
      </div>

      {/* Weekly focus note */}
      <p className="text-sm text-gray-600 leading-relaxed">
        {phase.weeklyFocusNote}
      </p>

      {/* Goal countdowns */}
      {upcomingGoals.length > 0 && (
        <div className="flex gap-2">
          {upcomingGoals.map((goal) => (
            <div
              key={goal.id}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-center"
            >
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">
                {goal.emoji} {goal.label}
              </p>
              <p className="text-base font-bold text-gray-900">
                {Math.ceil(goal.days / 7)}w
              </p>
            </div>
          ))}
        </div>
      )}

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
                  ? "bg-indigo-50 border-indigo-200"
                  : isSkipped
                  ? "bg-gray-100 border-gray-200"
                  : "bg-gray-100 border-gray-200"
              }`}
            >
              <span className={`text-sm leading-none ${isActive ? "opacity-100" : "opacity-30"}`}>
                {slot.icon}
              </span>
              {isSkipped && (
                <span className="text-[8px] text-gray-400 leading-none">skip</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
