"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import BottomNav from "@/components/BottomNav";
import type { FatigueSnapshot, SleepEntry, RestingHREntry, EnrichedSession, AthleteProfile, Goal } from "@/types";
import type { StoredActivity, StoredSession } from "@/lib/kv";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FatiguePoint {
  date: string;
  label: string;
  neuromuscular: number;
  cardiovascular: number;
  metabolic: number;
}

interface DashboardData {
  snapshot: FatigueSnapshot | null;
  schedule: { sessions: StoredSession[] } | null;
  sleepLast7: (SleepEntry | null)[];
  sleepAvg30Hours: number | null;
  rhrLast7: (RestingHREntry | null)[];
  rhrAvg30Bpm: number | null;
  lastSession: EnrichedSession | null;
  activities: StoredActivity[];
  fatigueHistory: FatiguePoint[];
  profile: AthleteProfile | null;
  cachedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_CONFIG: Record<string, { icon: string; label: string; isHard: boolean }> = {
  Crossfit:  { icon: "🏋️", label: "CrossFit",  isHard: true  },
  Strength:  { icon: "💪", label: "Strength",  isHard: true  },
  Run:       { icon: "🏃", label: "Run",        isHard: false },
  Bike:      { icon: "🚴", label: "Bike",       isHard: false },
};

const STRAVA_TYPE_ICON: Record<string, string> = {
  Run: "🏃", VirtualRun: "🏃",
  Ride: "🚴", VirtualRide: "🚴",
  WeightTraining: "💪", Strength: "💪", Workout: "💪",
  Crossfit: "🏋️",
  Walk: "🚶", Hike: "🥾", Swim: "🏊",
};

const CIRCUMFERENCE = 2 * Math.PI * 54; // r=54 → ≈339.29

// ─── Helpers ─────────────────────────────────────────────────────────────────

function verdictColor(verdict: string): string {
  switch (verdict) {
    case "ready":    return "#00E5A0";
    case "moderate": return "#F59E0B";
    case "caution":  return "#F97316";
    case "recover":  return "#EF4444";
    default:         return "#6B7280";
  }
}

function chipStyle(score: number): string {
  if (score < 40) return "bg-green-100/50 backdrop-blur-md text-green-700 border border-green-200/60";
  if (score < 65) return "bg-amber-100/50 backdrop-blur-md text-amber-700 border border-amber-200/60";
  if (score < 85) return "bg-orange-100/50 backdrop-blur-md text-orange-700 border border-orange-200/60";
  return "bg-red-100/50 backdrop-blur-md text-red-700 border border-red-200/60";
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function minsToHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReadinessGauge({ score, color }: { score: number; color: string }) {
  const offset = CIRCUMFERENCE * (1 - score / 100);
  return (
    <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
      <circle cx="60" cy="60" r="54" fill="none" stroke="#E5E7EB" strokeWidth="8" />
      <circle
        cx="60" cy="60" r="54" fill="none"
        stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
}

function BarSparkline({
  values,
  maxVal,
  color,
}: {
  values: (number | null)[];
  maxVal: number;
  color: string;
}) {
  const W = 10, GAP = 2;
  const totalW = values.length * (W + GAP) - GAP;
  return (
    <svg width={totalW} height={28}>
      {values.map((v, i) => {
        const h = v != null ? Math.max(2, (v / maxVal) * 28) : 2;
        return (
          <rect
            key={i}
            x={i * (W + GAP)}
            y={28 - h}
            width={W}
            height={h}
            rx={2}
            fill={v != null ? color : "#E5E7EB"}
          />
        );
      })}
    </svg>
  );
}

function Skeleton({ h = "h-24" }: { h?: string }) {
  return <div className={`bg-white/40 animate-pulse rounded-2xl ${h}`} />;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { status } = useSession();
  const router = useRouter();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    setLoading(true);
    const url = refreshKey > 0 ? `/api/dashboard?bust=${refreshKey}` : "/api/dashboard";
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        setLastUpdated(new Date());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status, refreshKey]);

  const today = new Date();
  const todayISO = isoDate(today);

  // Nearest upcoming goal
  const nearestGoal: Goal | null =
    data?.profile?.goals
      ?.filter((g) => g.date > todayISO)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  const daysUntil = nearestGoal
    ? Math.ceil(
        (new Date(nearestGoal.date + "T00:00:00").getTime() -
          new Date(todayISO + "T00:00:00").getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  // Today's sessions and activities
  const todayActivities = (data?.activities ?? []).filter((a) =>
    a.start_date.startsWith(todayISO)
  );

  // Week strip (Mon–Sun of current week)
  const mondayDate = (() => {
    const d = new Date(today);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  })();

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mondayDate);
    d.setDate(mondayDate.getDate() + i);
    const iso = isoDate(d);
    const label = ["M", "T", "W", "T", "F", "S", "S"][i];
    const isToday = iso === todayISO;
    const sessionForDay = data?.schedule?.sessions?.find((s) => s.day === iso);
    const activityForDay = (data?.activities ?? []).find((a) => a.start_date.startsWith(iso));
    const hasActivity = activityForDay != null;
    const isPast = iso < todayISO;

    const icon = sessionForDay
      ? (SESSION_CONFIG[sessionForDay.type]?.icon ?? "💪")
      : activityForDay
      ? (STRAVA_TYPE_ICON[activityForDay.type] ?? "🏃")
      : null;

    const status: "done" | "missed" | "upcoming" | "rest" = hasActivity
      ? "done"
      : sessionForDay && isPast
      ? "missed"
      : sessionForDay
      ? "upcoming"
      : "rest";

    return { iso, label, isToday, icon, status };
  });

  // Last updated label
  const updatedLabel = (() => {
    if (!lastUpdated) return null;
    const mins = Math.floor((Date.now() - lastUpdated.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    return `${mins} mins ago`;
  })();

  const snapshot = data?.snapshot ?? null;
  const color = snapshot ? verdictColor(snapshot.overall.verdict) : "#6B7280";

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-indigo-50/40 to-violet-50/30 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-indigo-50/40 to-violet-50/30 pb-20">
      {/* ── Section 1: Header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3 max-w-lg mx-auto">
        <span className="text-gray-500 text-sm font-medium">
          {today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </span>
        {nearestGoal && daysUntil != null ? (
          <Link href="/about">
            <span className="bg-white/60 backdrop-blur-sm text-gray-700 text-xs px-3 py-1.5 rounded-full border border-white/50">
              {nearestGoal.emoji} {daysUntil}d to {nearestGoal.label}
            </span>
          </Link>
        ) : (
          <Link href="/about">
            <span className="bg-white/60 backdrop-blur-sm text-gray-500 text-xs px-3 py-1.5 rounded-full border border-white/50">
              Set a goal →
            </span>
          </Link>
        )}
      </div>

      <main className="max-w-lg mx-auto px-4 space-y-4">
        {/* ── Section 2: Readiness Hero ─────────────────────────────────────── */}
        {loading ? (
          <Skeleton h="h-36" />
        ) : snapshot ? (
          <Link href="/readiness" className="block bg-white/65 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/[0.04] rounded-2xl p-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-shrink-0">
                <ReadinessGauge score={snapshot.overall.score} color={color} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl leading-none">{snapshot.overall.verdictEmoji}</span>
                  <span className="text-2xl font-bold text-gray-900 leading-none mt-1">
                    {snapshot.overall.score}
                  </span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 font-semibold text-lg capitalize">{snapshot.overall.verdict}</p>
                <p className="text-gray-600 text-sm mt-1 leading-relaxed">
                  {snapshot.overall.recommendation}
                </p>
                {snapshot.overall.sleepScore != null && (
                  <div className="flex gap-2 mt-2">
                    <span className="text-xs bg-white/50 backdrop-blur-sm text-gray-600 px-2 py-0.5 rounded-full border border-white/50">
                      😴 {snapshot.overall.sleepScore}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Link>
        ) : (
          <div className="bg-white/65 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/[0.04] rounded-2xl p-4 text-center">
            <p className="text-gray-500 text-sm">No readiness data yet.</p>
            <Link href="/readiness" className="text-indigo-600 text-sm mt-1 inline-block">
              View readiness →
            </Link>
          </div>
        )}

        {/* ── Section 3: Fatigue Chips ──────────────────────────────────────── */}
        {loading ? (
          <Skeleton h="h-20" />
        ) : snapshot ? (
          <Link href="/readiness" className="grid grid-cols-3 gap-3">
            {[
              { label: "Neuromuscular", icon: "💪", score: snapshot.neuromuscular.score, freshness: snapshot.neuromuscular.freshness },
              { label: "Cardiovascular", icon: "❤️", score: snapshot.cardiovascular.score, freshness: snapshot.cardiovascular.freshness },
              { label: "Metabolic",      icon: "⚡", score: snapshot.metabolic.score,      freshness: snapshot.metabolic.freshness },
            ].map((sys) => (
              <div key={sys.label} className={`rounded-2xl p-3 text-center ${chipStyle(sys.score)}`}>
                <p className="text-xs opacity-70 mb-1">{sys.icon}</p>
                <p className="text-lg font-bold leading-none">{sys.freshness}</p>
                <p className="text-xs opacity-70 mt-1">{sys.label.slice(0, 6)}</p>
              </div>
            ))}
          </Link>
        ) : null}

        {/* ── Section 4: Next Session ───────────────────────────────────────── */}
        {!loading && (() => {
          const nextSession = data?.schedule?.sessions
            ?.filter((s) => s.day >= todayISO)
            .sort((a, b) => a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime))[0] ?? null;

          if (!nextSession) return (
            <Link href="/schedule" className="block bg-white/65 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/[0.04] rounded-2xl p-4">
              <h2 className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                Next Session
              </h2>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">📅</span>
                  <div>
                    <p className="text-gray-900 font-semibold text-base">Nothing scheduled</p>
                    <p className="text-gray-500 text-xs mt-0.5">Plan next week →</p>
                  </div>
                </div>
              </div>
            </Link>
          );

          const cfg = SESSION_CONFIG[nextSession.type] ?? { icon: "💪", label: nextSession.type, isHard: false };
          const isToday = nextSession.day === todayISO;
          const sessionDate = new Date(nextSession.day + "T12:00:00");
          const dayLabel = isToday
            ? "Today"
            : sessionDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

          const isDone = isToday && todayActivities.length > 0;
          const showWarning = !isDone && cfg.isHard && snapshot?.overall.verdict === "recover";

          return (
            <Link href="/schedule" className="block bg-white/65 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/[0.04] rounded-2xl p-4">
              <h2 className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                Next Session
              </h2>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{cfg.icon}</span>
                  <div>
                    <p className="text-gray-900 font-semibold text-base">{cfg.label}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{dayLabel} · {nextSession.startTime}</p>
                  </div>
                </div>
                {isDone ? (
                  <span className="text-xs bg-green-100/50 backdrop-blur-sm text-green-700 px-2.5 py-1 rounded-full border border-green-200/60">✓ Done</span>
                ) : showWarning ? (
                  <span className="text-xs bg-red-100/50 backdrop-blur-sm text-red-700 px-2.5 py-1 rounded-full border border-red-200/60">⚠️ Reschedule?</span>
                ) : (
                  <span className="text-xs bg-white/50 backdrop-blur-sm text-gray-500 px-2.5 py-1 rounded-full border border-white/50">Scheduled</span>
                )}
              </div>
            </Link>
          );
        })()}

        {/* ── Section 5: Week at a Glance ───────────────────────────────────── */}
        {!loading && (
          <div className="bg-white/65 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/[0.04] rounded-2xl p-4">
            <h2 className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
              This Week
            </h2>
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map((day) => (
                <div key={day.iso} className="flex flex-col items-center gap-1">
                  <span
                    className={`text-xs font-medium ${
                      day.isToday ? "text-[#00E5A0]" : "text-gray-400"
                    }`}
                  >
                    {day.label}
                  </span>
                  <span className={`text-base leading-none ${
                    day.status === "done" ? "opacity-100" :
                    day.status === "missed" ? "opacity-40" :
                    day.status === "upcoming" ? "opacity-70" :
                    "opacity-20"
                  }`}>
                    {day.icon ?? "·"}
                  </span>
                  <span className="text-xs leading-none h-4">
                    {day.status === "done" ? "✅" : day.status === "missed" ? "⚠️" : day.status === "upcoming" ? "🔵" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Section 6: Training Load Chart ───────────────────────────────── */}
        {loading ? (
          <Skeleton h="h-36" />
        ) : data?.fatigueHistory && data.fatigueHistory.some((f) => f.neuromuscular + f.cardiovascular + f.metabolic > 0) ? (
          <Link href="/readiness" className="block bg-white/65 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/[0.04] rounded-2xl p-4">
            <h2 className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
              Training Load (14 days)
            </h2>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={data.fatigueHistory} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#9CA3AF", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  interval={6}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "#9CA3AF", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.6)", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "#6B7280" }}
                  itemStyle={{ color: "#111827" }}
                />
                <ReferenceLine y={65} stroke="#F59E0B" strokeDasharray="3 3" strokeOpacity={0.6} />
                <ReferenceLine y={85} stroke="#EF4444" strokeDasharray="3 3" strokeOpacity={0.6} />
                <Line dataKey="neuromuscular" stroke="#F97316" dot={false} strokeWidth={1.5} name="Neuro" />
                <Line dataKey="cardiovascular" stroke="#60A5FA" dot={false} strokeWidth={1.5} name="Cardio" />
                <Line dataKey="metabolic"      stroke="#A78BFA" dot={false} strokeWidth={1.5} name="Metabolic" />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2">
              {[
                { color: "#F97316", label: "Neuromuscular", dashed: false },
                { color: "#60A5FA", label: "Cardiovascular", dashed: false },
                { color: "#A78BFA", label: "Metabolic",      dashed: false },
                { color: "#F59E0B", label: "Caution (65)",   dashed: true  },
                { color: "#EF4444", label: "High risk (85)", dashed: true  },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  {item.dashed ? (
                    <svg width="14" height="6">
                      <line x1="0" y1="3" x2="14" y2="3" stroke={item.color} strokeWidth="1.5" strokeDasharray="3 2" />
                    </svg>
                  ) : (
                    <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: item.color }} />
                  )}
                  <span className="text-gray-500 text-xs">{item.label}</span>
                </div>
              ))}
            </div>
          </Link>
        ) : null}

        {/* ── Section 7: Sleep & Recovery ───────────────────────────────────── */}
        {!loading && (
          <div className="grid grid-cols-2 gap-3">
            {/* Sleep panel */}
            <Link href="/readiness" className="block bg-white/65 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/[0.04] rounded-2xl p-3">
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
                😴 Sleep
              </p>
              {(() => {
                const lastNight = data?.sleepLast7?.[6] ?? data?.sleepLast7?.[5] ?? null;
                const avg = data?.sleepAvg30Hours;
                const hours = lastNight?.hours ?? null;
                const compLabel = hours != null && avg != null
                  ? hours >= avg
                    ? { text: "↑ above avg", cls: "text-green-600" }
                    : hours >= avg * 0.9
                    ? { text: "→ at avg", cls: "text-gray-500" }
                    : { text: "↓ below avg", cls: "text-amber-600" }
                  : null;
                const sleepValues = (data?.sleepLast7 ?? []).map((e) => e?.hours ?? null);
                return (
                  <>
                    <p className="text-gray-900 text-2xl font-bold leading-none">
                      {hours != null ? `${hours}h` : "—"}
                    </p>
                    {compLabel && (
                      <p className={`text-xs mt-0.5 ${compLabel.cls}`}>{compLabel.text}</p>
                    )}
                    {avg != null && (
                      <p className="text-gray-400 text-xs mt-0.5">{avg}h avg/30d</p>
                    )}
                    <div className="mt-2">
                      <BarSparkline values={sleepValues} maxVal={10} color="#60A5FA" />
                    </div>
                  </>
                );
              })()}
            </Link>

            {/* Resting HR panel */}
            <Link href="/readiness" className="block bg-white/65 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/[0.04] rounded-2xl p-3">
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
                ❤️ Resting HR
              </p>
              {(() => {
                const todayRHR = data?.rhrLast7?.[6] ?? data?.rhrLast7?.[5] ?? null;
                const avg = data?.rhrAvg30Bpm;
                // Fall back to static profile value if no daily entries yet
                const bpm = todayRHR?.bpm ?? data?.profile?.restingHR ?? null;
                const isProfileFallback = todayRHR == null && bpm != null;
                const compLabel = bpm != null && avg != null
                  ? bpm <= avg * 1.03
                    ? { text: "↓ normal", cls: "text-green-600" }
                    : bpm <= avg * 1.08
                    ? { text: "→ slightly elevated", cls: "text-amber-600" }
                    : { text: "↑ elevated", cls: "text-red-600" }
                  : null;
                const rhrValues = (data?.rhrLast7 ?? []).map((e) => e?.bpm ?? null);
                const maxBpm = Math.max(...rhrValues.filter((v): v is number => v !== null), 80);
                return (
                  <>
                    <p className="text-gray-900 text-2xl font-bold leading-none">
                      {bpm != null ? `${bpm}` : "—"}
                      {bpm != null && <span className="text-sm font-normal text-gray-400 ml-1">bpm</span>}
                    </p>
                    {compLabel && (
                      <p className={`text-xs mt-0.5 ${compLabel.cls}`}>{compLabel.text}</p>
                    )}
                    {isProfileFallback && (
                      <p className="text-gray-400 text-xs mt-0.5">from profile</p>
                    )}
                    {avg != null && (
                      <p className="text-gray-400 text-xs mt-0.5">{avg} bpm avg/30d</p>
                    )}
                    {rhrValues.some((v) => v !== null) && (
                      <div className="mt-2">
                        <BarSparkline values={rhrValues} maxVal={maxBpm} color="#F87171" />
                      </div>
                    )}
                  </>
                );
              })()}
            </Link>
          </div>
        )}

        {/* ── Section 8: Last Session ───────────────────────────────────────── */}
        {!loading && data?.lastSession && (
          <Link
            href={`/session/${data.lastSession.date}`}
            className="block bg-white/65 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/[0.04] rounded-2xl p-4"
          >
            <h2 className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
              Last Session
            </h2>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-gray-900 font-semibold">
                  {data.lastSession.wod?.box ?? "Training Session"}
                </p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {new Date(data.lastSession.date + "T12:00:00").toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </div>
              {data.lastSession.wod?.sessionType && (
                <span className="text-xs bg-white/50 backdrop-blur-sm text-gray-600 px-2 py-1 rounded-full capitalize border border-white/50">
                  {data.lastSession.wod.sessionType.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <div className="flex gap-5">
              {data.lastSession.enrichedIntensity != null && (
                <div>
                  <p className="text-gray-500 text-xs">
                    {data.lastSession.dominantStressType === "cardiovascular"
                      ? "Effort"
                      : data.lastSession.dominantStressType === "neuromuscular"
                      ? "Load"
                      : "Intensity"}
                  </p>
                  <p className="text-gray-900 font-bold">{data.lastSession.enrichedIntensity}/10</p>
                </div>
              )}
              {data.lastSession.performance?.averageHR != null && (
                <div>
                  <p className="text-gray-500 text-xs">Avg HR</p>
                  <p className="text-gray-900 font-bold">{data.lastSession.performance.averageHR} bpm</p>
                </div>
              )}
              {data.lastSession.performance?.duration != null && (
                <div>
                  <p className="text-gray-500 text-xs">Duration</p>
                  <p className="text-gray-900 font-bold">{minsToHM(data.lastSession.performance.duration)}</p>
                </div>
              )}
            </div>
            {(data.lastSession.sessionNotes?.parsed?.liftData?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {data.lastSession.sessionNotes!.parsed.liftData.slice(0, 4).map((lift, i) => (
                  <span
                    key={i}
                    className="text-xs bg-white/50 backdrop-blur-sm text-gray-600 px-2 py-0.5 rounded-full border border-white/50"
                  >
                    {lift.lift} {lift.topSetWeight}kg
                  </span>
                ))}
              </div>
            )}
          </Link>
        )}

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between py-2">
          <p className="text-gray-400 text-xs">
            {updatedLabel ? `Updated ${updatedLabel}` : "Loading…"}
          </p>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
