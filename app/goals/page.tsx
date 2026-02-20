"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  GOALS,
  TRAINING_PHASES,
  PLAN_START,
  daysUntilGoal,
  getTrainingWeek,
  getCurrentPhase,
} from "@/lib/training-config";
import type { StoredActivity, TrainingLoad } from "@/lib/kv";

function formatMins(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function activityTypeLabel(type: string): string {
  switch (type) {
    case "Ride":
    case "VirtualRide":
      return "🚴";
    case "Run":
    case "VirtualRun":
      return "🏃";
    case "WeightTraining":
    case "Crossfit":
      return "🏋️";
    default:
      return "🏅";
  }
}

export default function GoalsPage() {
  const today = new Date();
  const currentWeek = getTrainingWeek(today);
  const phaseCtx = getCurrentPhase(today);
  const longRideTarget = phaseCtx?.phase.longRideTargetKm ?? 0;

  const [activities, setActivities] = useState<StoredActivity[]>([]);
  const [trainingLoad, setTrainingLoad] = useState<TrainingLoad | null>(null);
  const [stravaConnected, setStravaConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/sync/status")
      .then((r) => r.json())
      .then((d) => {
        setActivities(d.recentActivities ?? []);
        setTrainingLoad(d.trainingLoad ?? null);
        setStravaConnected(d.stravaConnected ?? false);
      })
      .catch(() => setStravaConnected(false));
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur border-b border-zinc-800/60">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-zinc-400 hover:text-white transition-colors text-lg"
            >
              ←
            </Link>
            <span className="font-bold text-white text-lg">Training Plan</span>
          </div>
          {currentWeek >= 1 && currentWeek <= 17 && (
            <span className="text-sm text-zinc-500">Week {currentWeek}</span>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Goal countdown cards */}
        <div className="grid grid-cols-2 gap-3">
          {GOALS.map((goal) => {
            const days = daysUntilGoal(goal.date, today);
            const weeks = Math.ceil(days / 7);
            const dateStr = new Date(goal.date + "T12:00:00").toLocaleDateString(
              "en-GB",
              { day: "numeric", month: "short", year: "numeric" }
            );

            return (
              <div
                key={goal.id}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4"
              >
                <div className="text-2xl mb-2">{goal.emoji}</div>
                <p className="text-sm font-semibold text-white leading-tight">
                  {goal.label}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">{dateStr}</p>
                {days > 0 ? (
                  <>
                    <p className="text-2xl font-bold text-white mt-3">
                      {weeks}w
                    </p>
                    <p className="text-xs text-zinc-500">{days} days away</p>
                  </>
                ) : (
                  <p className="text-sm font-bold text-green-400 mt-3">Done! 🎉</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Phase timeline */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            Training Phases
          </h2>
          <div className="space-y-2">
            {TRAINING_PHASES.map((phase) => {
              const isCurrent =
                currentWeek >= phase.startWeek && currentWeek <= phase.endWeek;
              const isPast = currentWeek > phase.endWeek;
              const weekInPhase = isCurrent
                ? currentWeek - phase.startWeek + 1
                : null;
              const weeksInPhase = phase.endWeek - phase.startWeek + 1;

              // Calculate human-readable date range for this phase
              const startDate = new Date(PLAN_START);
              startDate.setDate(
                startDate.getDate() + (phase.startWeek - 1) * 7
              );
              const endDate = new Date(PLAN_START);
              endDate.setDate(endDate.getDate() + phase.endWeek * 7 - 1);
              const fmt = (d: Date) =>
                d.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                });
              const dateRange = `${fmt(startDate)} – ${fmt(endDate)}`;

              const progressPct = isCurrent
                ? ((weekInPhase! - 1) / weeksInPhase) * 100
                : isPast
                ? 100
                : 0;

              return (
                <div
                  key={phase.name}
                  className={`rounded-2xl border p-4 transition-all ${
                    isCurrent
                      ? "bg-indigo-950/40 border-indigo-500/40"
                      : isPast
                      ? "bg-zinc-900/30 border-zinc-800/40 opacity-50"
                      : "bg-zinc-900/20 border-zinc-800/30"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{phase.emoji}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <p
                            className={`text-sm font-semibold ${
                              isCurrent
                                ? "text-indigo-300"
                                : isPast
                                ? "text-zinc-500"
                                : "text-zinc-300"
                            }`}
                          >
                            {phase.name}
                          </p>
                          {isCurrent && (
                            <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-full">
                              Now
                            </span>
                          )}
                          {isPast && (
                            <span className="text-zinc-600 text-xs">✓</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-600">{dateRange}</p>
                      </div>
                    </div>
                    <span className="text-xs text-zinc-600 flex-shrink-0 mt-0.5">
                      {weeksInPhase}w
                    </span>
                  </div>

                  {/* Progress bar for current and past phases */}
                  {(isCurrent || isPast) && (
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-2">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isCurrent ? "bg-indigo-500" : "bg-zinc-600"
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}

                  {/* Focus note for current phase only */}
                  {isCurrent && (
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      {phase.weeklyFocusNote}
                    </p>
                  )}

                  {/* Ride target for upcoming phases */}
                  {!isCurrent && !isPast && phase.longRideTargetMiles > 0 && (
                    <p className="text-xs text-zinc-600">
                      Target ride: {phase.longRideTargetKm} km
                    </p>
                  )}

                  {/* Session type icons */}
                  {!isPast && (
                    <div className="flex gap-1 mt-2">
                      {phase.weeklyPlan.map((s, i) => (
                        <span key={i} className="text-sm opacity-60">
                          {s.type === "Crossfit"
                            ? "🏋️"
                            : s.type === "Strength"
                            ? "💪"
                            : s.type === "Run"
                            ? "🏃"
                            : "🚴"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Strava activity feed */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            Recent Activities
          </h2>

          {stravaConnected === false && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center">
              <p className="text-sm text-zinc-400 mb-3">
                Connect Strava to see your activity history
              </p>
              <a
                href="/api/strava/connect"
                className="inline-block text-sm px-4 py-2 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors"
              >
                Connect Strava
              </a>
            </div>
          )}

          {stravaConnected && activities.length === 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-center">
              <p className="text-sm text-zinc-500">No activities synced yet.</p>
            </div>
          )}

          {trainingLoad && (
            <div className="grid grid-cols-3 gap-2 mb-3 text-center text-sm">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <p className="text-lg font-bold text-blue-400">{trainingLoad.weekBikeKm ?? 0}</p>
                <p className="text-xs text-zinc-500">Bike km</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <p className="text-lg font-bold text-green-400">{trainingLoad.weekRunKm ?? 0}</p>
                <p className="text-xs text-zinc-500">Run km</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <p className="text-lg font-bold text-purple-400">
                  {trainingLoad.sessionsCompleted}/{trainingLoad.sessionsScheduled}
                </p>
                <p className="text-xs text-zinc-500">Done</p>
              </div>
            </div>
          )}

          {activities.length > 0 && (
            <div className="space-y-2">
              {activities.map((a) => {
                const isLongRide =
                  (a.type === "Ride" || a.type === "VirtualRide") &&
                  a.distance >= longRideTarget * 0.9;
                const dateStr = new Date(a.start_date).toLocaleDateString(
                  "en-GB",
                  { day: "numeric", month: "short" }
                );

                return (
                  <div
                    key={a.id}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 border ${
                      isLongRide && longRideTarget > 0
                        ? "bg-indigo-950/30 border-indigo-500/30"
                        : "bg-zinc-900 border-zinc-800"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-base flex-shrink-0">
                        {activityTypeLabel(a.type)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-200 font-medium truncate">
                          {a.name}
                        </p>
                        <p className="text-xs text-zinc-500">{dateStr}</p>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {a.distance > 0 && (
                        <p className="text-sm font-semibold text-zinc-200">
                          {a.distance} km
                        </p>
                      )}
                      <p className="text-xs text-zinc-500">
                        {formatMins(a.moving_time)}
                      </p>
                      {isLongRide && longRideTarget > 0 && (
                        <span className="text-[10px] text-indigo-400">Long ride ✓</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="h-4" />
      </main>
    </div>
  );
}
