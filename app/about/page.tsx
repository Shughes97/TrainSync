"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import BottomNav from "@/components/BottomNav";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { daysUntilGoal } from "@/lib/training-config";
import type { AthleteProfile, Goal, LiftKey, OneRepMaxEntry } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const LIFT_LABELS: Record<LiftKey, string> = {
  frontSquat: "Front Squat",
  backSquat:  "Back Squat",
  deadlift:   "Deadlift",
  clean:      "Clean",
  snatch:     "Snatch",
  benchPress: "Bench Press",
  strictPress:"Strict Press",
};

const LIFT_KEYS: LiftKey[] = [
  "frontSquat", "backSquat", "deadlift", "clean", "snatch", "benchPress", "strictPress",
];

const TRAINING_AGE_OPTIONS = ["1-2 years", "3-5 years", "5+ years"] as const;
const GOAL_TYPES = ["endurance_event", "physique", "strength", "other"] as const;
const GOAL_EMOJIS = ["🚴", "🏋️", "🏃", "🏖️", "🏆", "🎯", "💪"] as const;

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ history, liftKey }: { history: OneRepMaxEntry[]; liftKey: string }) {
  const data = history
    .filter((e) => e.lift === liftKey)
    .slice(-10)
    .map((e) => ({ v: e.estimatedMax }));

  if (data.length < 2) return <span className="text-xs text-gray-300">—</span>;

  return (
    <div className="w-20 h-7">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="v"
            stroke="#6366f1"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "#6366f1" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Saved flash ──────────────────────────────────────────────────────────────

function useSavedFlash() {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    setShow(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShow(false), 1500);
  }, []);
  return { show, flash };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AboutPage() {
  const { status } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { show: saved, flash: flashSaved } = useSavedFlash();
  const [editingGoalIdx, setEditingGoalIdx] = useState<number | null>(null);
  const [host, setHost] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  useEffect(() => {
    setHost(window.location.origin);
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/athlete")
      .then((r) => r.ok ? r.json() : null)
      .then((data: AthleteProfile | null) => {
        if (data) setProfile(data);
      })
      .finally(() => setLoading(false));
  }, [status]);

  async function save(patch: Partial<AthleteProfile>) {
    if (!profile) return;
    const next = { ...profile, ...patch };
    setProfile(next);
    await fetch("/api/athlete", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    flashSaved();
  }

  async function saveOneRM(lift: LiftKey, value: string) {
    if (!profile) return;
    const num = parseFloat(value);
    const updated = isNaN(num) ? null : Math.round(num * 10) / 10;
    const oneRepMaxes = { ...profile.oneRepMaxes, [lift]: updated };
    setProfile({ ...profile, oneRepMaxes });
    await fetch("/api/athlete", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oneRepMaxes }),
    });
    flashSaved();
  }

  // ─── Goal helpers ─────────────────────────────────────────────────────────

  function addGoal() {
    if (!profile) return;
    const newGoal: Goal = {
      id: `goal_${Date.now()}`,
      label: "New Goal",
      date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      type: "other",
      emoji: "🎯",
    };
    const goals = [...profile.goals, newGoal];
    save({ goals });
    setEditingGoalIdx(goals.length - 1);
  }

  function updateGoal(idx: number, patch: Partial<Goal>) {
    if (!profile) return;
    const goals = profile.goals.map((g, i) => i === idx ? { ...g, ...patch } : g);
    save({ goals });
  }

  function removeGoal(idx: number) {
    if (!profile) return;
    const goals = profile.goals.filter((_, i) => i !== idx);
    save({ goals });
    if (editingGoalIdx === idx) setEditingGoalIdx(null);
  }

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const lastUpdatedForLift = (liftKey: string): string | null => {
    const entries = profile.oneRepMaxHistory.filter((e) => e.lift === liftKey);
    if (!entries.length) return null;
    return entries[entries.length - 1].date;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-gray-50/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-bold text-gray-900 text-lg">👤 Profile</h1>
          {saved && (
            <span className="text-xs text-green-600 font-medium animate-pulse">Saved ✓</span>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* ── Personal Stats ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Personal Stats
          </h2>
          <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 shadow-sm">

            {/* Name */}
            <div className="flex items-center px-4 py-3">
              <span className="text-sm text-gray-500 w-28 flex-shrink-0">Name</span>
              <input
                type="text"
                defaultValue={profile.name}
                placeholder="Your name"
                onBlur={(e) => save({ name: e.target.value })}
                className="flex-1 text-sm text-gray-900 bg-transparent focus:outline-none text-right"
              />
            </div>

            {/* Age */}
            <div className="flex items-center px-4 py-3">
              <span className="text-sm text-gray-500 w-28 flex-shrink-0">Age</span>
              <input
                type="number"
                defaultValue={profile.age ?? ""}
                placeholder="—"
                min={10} max={99}
                onBlur={(e) => save({ age: e.target.value ? parseInt(e.target.value) : null })}
                className="flex-1 text-sm text-gray-900 bg-transparent focus:outline-none text-right"
              />
            </div>

            {/* Height */}
            <div className="flex items-center px-4 py-3">
              <span className="text-sm text-gray-500 w-28 flex-shrink-0">Height (cm)</span>
              <input
                type="number"
                defaultValue={profile.height ?? ""}
                placeholder="—"
                min={100} max={250}
                onBlur={(e) => save({ height: e.target.value ? parseInt(e.target.value) : null })}
                className="flex-1 text-sm text-gray-900 bg-transparent focus:outline-none text-right"
              />
            </div>

            {/* Weight */}
            <div className="flex items-center px-4 py-3">
              <span className="text-sm text-gray-500 w-28 flex-shrink-0">Weight (kg)</span>
              <input
                type="number"
                defaultValue={profile.weight ?? ""}
                placeholder="—"
                step="0.1" min={30} max={300}
                onBlur={(e) => save({ weight: e.target.value ? parseFloat(e.target.value) : null })}
                className="flex-1 text-sm text-gray-900 bg-transparent focus:outline-none text-right"
              />
            </div>

            {/* Max HR */}
            <div className="flex items-center px-4 py-3">
              <span className="text-sm text-gray-500 w-28 flex-shrink-0">Max HR</span>
              {profile.maxHRSource === "strava_auto" ? (
                <div className="flex-1 flex items-center justify-end gap-2">
                  <span className="text-xs bg-orange-100 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5">
                    Strava auto
                  </span>
                  <span className="text-sm font-medium text-gray-900">{profile.maxHR} bpm</span>
                </div>
              ) : (
                <input
                  type="number"
                  defaultValue={profile.maxHR ?? ""}
                  placeholder="—"
                  min={100} max={250}
                  onBlur={(e) => save({ maxHR: e.target.value ? parseInt(e.target.value) : null, maxHRSource: "manual" })}
                  className="flex-1 text-sm text-gray-900 bg-transparent focus:outline-none text-right"
                />
              )}
            </div>

            {/* Resting HR */}
            <div className="flex items-center px-4 py-3">
              <span className="text-sm text-gray-500 w-28 flex-shrink-0">Resting HR</span>
              <input
                type="number"
                defaultValue={profile.restingHR ?? ""}
                placeholder="—"
                min={30} max={100}
                onBlur={(e) => save({ restingHR: e.target.value ? parseInt(e.target.value) : null })}
                className="flex-1 text-sm text-gray-900 bg-transparent focus:outline-none text-right"
              />
              <span className="text-sm text-gray-400 ml-1">bpm</span>
            </div>

            {/* Training age */}
            <div className="flex items-start px-4 py-3">
              <span className="text-sm text-gray-500 w-28 flex-shrink-0 pt-0.5">Training Age</span>
              <div className="flex-1 flex gap-1 justify-end flex-wrap">
                {TRAINING_AGE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => save({ trainingAge: opt })}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      profile.trainingAge === opt
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </section>

        {/* ── 1RM Estimates ──────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              1RM Estimates
            </h2>
            <span
              className="text-xs text-gray-400"
              title="Estimated using: weight × (1 + reps ÷ 30)"
            >
              ℹ weight × (1 + reps/30)
            </span>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm divide-y divide-gray-100">
            {LIFT_KEYS.map((liftKey) => {
              const current = profile.oneRepMaxes[liftKey];
              const lastUpdated = lastUpdatedForLift(liftKey);
              return (
                <div key={liftKey} className="flex items-center px-4 py-3 gap-2">
                  <span className="text-sm text-gray-700 w-28 flex-shrink-0">
                    {LIFT_LABELS[liftKey]}
                  </span>
                  <div className="flex-1 flex items-center justify-end gap-3">
                    <Sparkline history={profile.oneRepMaxHistory} liftKey={liftKey} />
                    {lastUpdated && (
                      <span className="text-xs text-gray-400 hidden sm:block">
                        {lastUpdated}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        defaultValue={current ?? ""}
                        placeholder="—"
                        step="0.5" min={0} max={500}
                        onBlur={(e) => saveOneRM(liftKey, e.target.value)}
                        className="w-16 text-sm text-gray-900 text-right bg-transparent focus:outline-none border-b border-transparent focus:border-indigo-300"
                      />
                      <span className="text-xs text-gray-400">kg</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Personal Bests ──────────────────────────────────────────────── */}
        {profile.personalBests.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Personal Bests
            </h2>
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm divide-y divide-gray-100">
              {profile.personalBests.map((pb, i) => (
                <div key={i} className="flex items-center px-4 py-3">
                  <span className="text-sm text-gray-700 flex-1">
                    {LIFT_LABELS[pb.lift as LiftKey] ?? pb.lift}
                  </span>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-gray-900">
                      {pb.weight}kg × {pb.reps}
                    </span>
                    <p className="text-xs text-gray-400">{pb.date}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Goals ──────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Goals</h2>
            <button
              onClick={addGoal}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
            >
              + Add goal
            </button>
          </div>
          <div className="space-y-2">
            {profile.goals.map((goal, idx) => {
              const days = daysUntilGoal(goal.date);
              const isEditing = editingGoalIdx === idx;
              return (
                <div key={goal.id} className="bg-white border border-gray-200 rounded-2xl shadow-sm">
                  {/* Collapsed view */}
                  {!isEditing ? (
                    <div
                      className="flex items-center px-4 py-3 cursor-pointer"
                      onClick={() => setEditingGoalIdx(idx)}
                    >
                      <span className="text-xl mr-3">{goal.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{goal.label}</p>
                        <p className="text-xs text-gray-400">{goal.date} · {days > 0 ? `${days} days` : "past"}</p>
                      </div>
                      <span className="text-gray-300 text-sm ml-2">›</span>
                    </div>
                  ) : (
                    /* Edit view */
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        {/* Emoji picker */}
                        <div className="flex gap-1 flex-wrap">
                          {GOAL_EMOJIS.map((e) => (
                            <button
                              key={e}
                              onClick={() => updateGoal(idx, { emoji: e })}
                              className={`text-lg rounded-lg p-1 transition-colors ${
                                goal.emoji === e ? "bg-indigo-100" : "hover:bg-gray-100"
                              }`}
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        type="text"
                        value={goal.label}
                        onChange={(e) => updateGoal(idx, { label: e.target.value })}
                        placeholder="Goal name"
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-300"
                      />
                      <input
                        type="date"
                        value={goal.date}
                        onChange={(e) => updateGoal(idx, { date: e.target.value })}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-300"
                      />
                      <div className="flex gap-1 flex-wrap">
                        {GOAL_TYPES.map((t) => (
                          <button
                            key={t}
                            onClick={() => updateGoal(idx, { type: t })}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                              goal.type === t
                                ? "bg-indigo-600 text-white border-indigo-600"
                                : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                            }`}
                          >
                            {t.replace("_", " ")}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingGoalIdx(null)}
                          className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
                        >
                          Done
                        </button>
                        <button
                          onClick={() => removeGoal(idx)}
                          className="px-4 py-2 rounded-xl border border-gray-200 text-red-500 text-sm hover:bg-red-50 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Preferences ────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Preferences
          </h2>
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm divide-y divide-gray-100">
            {[
              { key: "morning", label: "Morning", sub: "6:30–8:00am" },
              { key: "evening", label: "Evening", sub: "5:00–8:00pm" },
            ].map(({ key, label, sub }) => {
              const active = profile.preferredWorkoutWindows.includes(key);
              return (
                <div
                  key={key}
                  className="flex items-center px-4 py-3 cursor-pointer"
                  onClick={() => {
                    const updated = active
                      ? profile.preferredWorkoutWindows.filter((w) => w !== key)
                      : [...profile.preferredWorkoutWindows, key];
                    save({ preferredWorkoutWindows: updated });
                  }}
                >
                  <div className="flex-1">
                    <p className="text-sm text-gray-900">{label}</p>
                    <p className="text-xs text-gray-400">{sub}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                    active ? "bg-indigo-600 border-indigo-600" : "border-gray-300"
                  }`}>
                    {active && <span className="text-white text-xs">✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Apple Health section */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest px-1 mb-2">Apple Health</h2>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-4">
              <p className="text-sm text-gray-700 font-medium mb-1">Sleep sync via iOS Shortcut</p>
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                Use an iOS Shortcut triggered by your Wake Up Alarm to automatically POST sleep data from Apple Health to TrainSync each morning.
              </p>
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">
                <code className="text-xs text-gray-700 break-all flex-1">
                  POST {host}/api/health/sleep
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(`${host}/api/health/sleep`)}
                  className="text-xs text-indigo-500 hover:text-indigo-700 shrink-0 font-medium"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Set <code className="bg-gray-100 rounded px-1">HEALTH_SYNC_SECRET</code> in Vercel env vars and use it as the Authorization Bearer token in your Shortcut. See the{" "}
                <a href="/readiness" className="text-indigo-500 hover:underline">Readiness page</a>{" "}
                for full step-by-step Shortcut setup instructions.
              </p>
            </div>
          </div>
        </section>

      </main>

      <BottomNav />
    </div>
  );
}
