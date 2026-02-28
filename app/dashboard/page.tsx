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
  if (score < 40) return "bg-green-900/40 text-green-400 border border-green-800/40";
  if (score < 65) return "bg-amber-900/40 text-amber-400 border border-amber-800/40";
  if (score < 85) return "bg-orange-900/40 text-orange-400 border border-orange-800/40";
  return "bg-red-900/40 text-red-400 border border-red-800/40";
}

function fatigueDotColor(avg: number): string {
  if (avg < 40) return "#00E5A0";
  if (avg < 65) return "#F59E0B";
  if (avg < 85) return "#F97316";
  return "#EF4444";
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
      <circle cx="60" cy="60" r="54" fill="none" stroke="#2A2A2A" strokeWidth="8" />
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
            fill={v != null ? color : "#27272A"}
          />
        );
      })}
    </svg>
  );
}

function Skeleton({ h = "h-24" }: { h?: string }) {
  return <div className={`bg-[#2A2A2A] animate-pulse rounded-2xl ${h}`} />;
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
  const todaySessions = data?.schedule?.sessions?.filter((s) => s.day === todayISO) ?? [];
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
    const hasActivity = (data?.activities ?? []).some((a) => a.start_date.startsWith(iso));
    const isPast = iso < todayISO;
    const dayFatigue = data?.fatigueHistory?.find((f) => f.date === iso);

    let indicator = "⚪";
    if (sessionForDay && hasActivity) indicator = "✅";
    else if (sessionForDay && isPast) indicator = "⚠️";
    else if (sessionForDay) indicator = "🔵";

    const dotColor = dayFatigue
      ? fatigueDotColor(
          (dayFatigue.neuromuscular + dayFatigue.cardiovascular + dayFatigue.metabolic) / 3
        )
      : "#3F3F46";

    return { iso, label, isToday, indicator, icon: sessionForDay ? (SESSION_CONFIG[sessionForDay.type]?.icon ?? "💪") : "", dotColor };
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
      <div className="min-h-screen bg-[#1A1A1A] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#00E5A0] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1A1A1A] pb-24">
      {/* ── Section 1: Header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <span className="text-zinc-400 text-sm font-medium">
          {today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </span>
        {nearestGoal && daysUntil != null ? (
          <Link href="/about">
            <span className="bg-[#2A2A2A] text-zinc-300 text-xs px-3 py-1.5 rounded-full">
              {nearestGoal.emoji} {daysUntil}d to {nearestGoal.label}
            </span>
          </Link>
        ) : (
          <Link href="/about">
            <span className="bg-[#2A2A2A] text-zinc-500 text-xs px-3 py-1.5 rounded-full">
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
          <Link href="/readiness" className="block bg-[#242424] border border-[#2A2A2A] rounded-2xl p-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-shrink-0">
                <ReadinessGauge score={snapshot.overall.score} color={color} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl leading-none">{snapshot.overall.verdictEmoji}</span>
                  <span className="text-2xl font-bold text-white leading-none mt-1">
                    {snapshot.overall.score}
                  </span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-lg capitalize">{snapshot.overall.verdict}</p>
                <p className="text-zinc-400 text-sm mt-1 leading-relaxed">
                  {snapshot.overall.recommendation}
                </p>
                {snapshot.overall.sleepScore != null && (
                  <div className="flex gap-2 mt-2">
                    <span className="text-xs bg-[#1A1A1A] text-zinc-400 px-2 py-0.5 rounded-full">
                      😴 {snapshot.overall.sleepScore}
                    </span>
                    {snapshot.overall.hrvScore != null && (
                      <span className="text-xs bg-[#1A1A1A] text-zinc-400 px-2 py-0.5 rounded-full">
                        ❤️ HRV {snapshot.overall.hrvScore}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Link>
        ) : (
          <div className="bg-[#242424] border border-[#2A2A2A] rounded-2xl p-4 text-center">
            <p className="text-zinc-500 text-sm">No readiness data yet.</p>
            <Link href="/readiness" className="text-[#00E5A0] text-sm mt-1 inline-block">
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
              { label: "Neuromuscular", icon: "💪", score: snapshot.neuromuscular.score },
              { label: "Cardiovascular", icon: "❤️", score: snapshot.cardiovascular.score },
              { label: "Metabolic",      icon: "⚡", score: snapshot.metabolic.score },
            ].map((sys) => (
              <div key={sys.label} className={`rounded-2xl p-3 text-center ${chipStyle(sys.score)}`}>
                <p className="text-xs opacity-70 mb-1">{sys.icon}</p>
                <p className="text-lg font-bold leading-none">{sys.score}</p>
                <p className="text-xs opacity-70 mt-1">{sys.label.slice(0, 6)}</p>
              </div>
            ))}
          </Link>
        ) : null}

        {/* ── Section 4: Today's Plan ───────────────────────────────────────── */}
        {!loading && (
          <div className="bg-[#242424] border border-[#2A2A2A] rounded-2xl p-4">
            <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-3">
              Today&apos;s Plan
            </h2>
            {todaySessions.length === 0 ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl">🛋️</span>
                <div>
                  <p className="text-white font-medium">Rest Day</p>
                  <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">
                    ✓ Recovery
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {todaySessions.map((s) => {
                  const cfg = SESSION_CONFIG[s.type] ?? { icon: "💪", label: s.type, isHard: false };
                  const done = todayActivities.length > 0;
                  const showWarning =
                    !done &&
                    cfg.isHard &&
                    snapshot?.overall.verdict === "recover";
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{cfg.icon}</span>
                        <div>
                          <p className="text-white font-medium">{cfg.label}</p>
                          <p className="text-zinc-500 text-xs">{s.startTime}</p>
                        </div>
                      </div>
                      {done ? (
                        <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">
                          ✓ Done
                        </span>
                      ) : showWarning ? (
                        <Link href="/schedule">
                          <span className="text-xs bg-red-900/40 text-red-400 px-2 py-0.5 rounded-full">
                            ⚠️ Reschedule?
                          </span>
                        </Link>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Section 5: Week at a Glance ───────────────────────────────────── */}
        {!loading && (
          <div className="bg-[#242424] border border-[#2A2A2A] rounded-2xl p-4">
            <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-3">
              This Week
            </h2>
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map((day) => (
                <div key={day.iso} className="flex flex-col items-center gap-1">
                  <span
                    className={`text-xs font-medium ${
                      day.isToday ? "text-[#00E5A0]" : "text-zinc-500"
                    }`}
                  >
                    {day.label}
                  </span>
                  <span className="text-sm leading-none">{day.icon || "·"}</span>
                  <span className="text-sm leading-none">{day.indicator}</span>
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: day.dotColor }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Section 6: Training Load Chart ───────────────────────────────── */}
        {loading ? (
          <Skeleton h="h-36" />
        ) : data?.fatigueHistory && data.fatigueHistory.some((f) => f.neuromuscular + f.cardiovascular + f.metabolic > 0) ? (
          <Link href="/readiness" className="block bg-[#242424] border border-[#2A2A2A] rounded-2xl p-4">
            <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-3">
              Training Load (14 days)
            </h2>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={data.fatigueHistory} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#52525B", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  interval={6}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "#52525B", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ background: "#242424", border: "1px solid #2A2A2A", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "#A1A1AA" }}
                  itemStyle={{ color: "#E4E4E7" }}
                />
                <ReferenceLine y={65} stroke="#F59E0B" strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine y={85} stroke="#EF4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                <Line dataKey="neuromuscular" stroke="#F97316" dot={false} strokeWidth={1.5} name="Neuro" />
                <Line dataKey="cardiovascular" stroke="#60A5FA" dot={false} strokeWidth={1.5} name="Cardio" />
                <Line dataKey="metabolic"      stroke="#A78BFA" dot={false} strokeWidth={1.5} name="Metabolic" />
              </LineChart>
            </ResponsiveContainer>
          </Link>
        ) : null}

        {/* ── Section 7: Sleep & Recovery ───────────────────────────────────── */}
        {!loading && (
          <div className="grid grid-cols-2 gap-3">
            {/* Sleep panel */}
            <Link href="/readiness" className="block bg-[#242424] border border-[#2A2A2A] rounded-2xl p-3">
              <p className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2">
                😴 Sleep
              </p>
              {(() => {
                const lastNight = data?.sleepLast7?.[6] ?? data?.sleepLast7?.[5] ?? null;
                const avg = data?.sleepAvg30Hours;
                const hours = lastNight?.hours ?? null;
                const compLabel = hours != null && avg != null
                  ? hours >= avg
                    ? { text: "↑ above avg", cls: "text-green-400" }
                    : hours >= avg * 0.9
                    ? { text: "→ at avg", cls: "text-zinc-400" }
                    : { text: "↓ below avg", cls: "text-amber-400" }
                  : null;
                const sleepValues = (data?.sleepLast7 ?? []).map((e) => e?.hours ?? null);
                return (
                  <>
                    <p className="text-white text-2xl font-bold leading-none">
                      {hours != null ? `${hours}h` : "—"}
                    </p>
                    {compLabel && (
                      <p className={`text-xs mt-0.5 ${compLabel.cls}`}>{compLabel.text}</p>
                    )}
                    {avg != null && (
                      <p className="text-zinc-600 text-xs mt-0.5">{avg}h avg/30d</p>
                    )}
                    <div className="mt-2">
                      <BarSparkline values={sleepValues} maxVal={10} color="#60A5FA" />
                    </div>
                  </>
                );
              })()}
            </Link>

            {/* Resting HR panel */}
            <Link href="/readiness" className="block bg-[#242424] border border-[#2A2A2A] rounded-2xl p-3">
              <p className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2">
                ❤️ Resting HR
              </p>
              {(() => {
                const todayRHR = data?.rhrLast7?.[6] ?? data?.rhrLast7?.[5] ?? null;
                const avg = data?.rhrAvg30Bpm;
                const bpm = todayRHR?.bpm ?? null;
                const compLabel = bpm != null && avg != null
                  ? bpm <= avg * 1.03
                    ? { text: "↓ normal", cls: "text-green-400" }
                    : bpm <= avg * 1.08
                    ? { text: "→ slightly elevated", cls: "text-amber-400" }
                    : { text: "↑ elevated", cls: "text-red-400" }
                  : null;
                const rhrValues = (data?.rhrLast7 ?? []).map((e) => e?.bpm ?? null);
                const maxBpm = Math.max(...rhrValues.filter((v): v is number => v !== null), 80);
                return (
                  <>
                    <p className="text-white text-2xl font-bold leading-none">
                      {bpm != null ? `${bpm}` : "—"}
                      {bpm != null && <span className="text-sm font-normal text-zinc-500 ml-1">bpm</span>}
                    </p>
                    {compLabel && (
                      <p className={`text-xs mt-0.5 ${compLabel.cls}`}>{compLabel.text}</p>
                    )}
                    {avg != null && (
                      <p className="text-zinc-600 text-xs mt-0.5">{avg} bpm avg/30d</p>
                    )}
                    <div className="mt-2">
                      <BarSparkline values={rhrValues} maxVal={maxBpm} color="#F87171" />
                    </div>
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
            className="block bg-[#242424] border border-[#2A2A2A] rounded-2xl p-4"
          >
            <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-3">
              Last Session
            </h2>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-white font-semibold">
                  {data.lastSession.wod?.box ?? "Training Session"}
                </p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {new Date(data.lastSession.date + "T12:00:00").toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </div>
              {data.lastSession.wod?.sessionType && (
                <span className="text-xs bg-[#1A1A1A] text-zinc-400 px-2 py-1 rounded-full capitalize">
                  {data.lastSession.wod.sessionType.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <div className="flex gap-5">
              {data.lastSession.enrichedIntensity != null && (
                <div>
                  <p className="text-zinc-500 text-xs">Intensity</p>
                  <p className="text-white font-bold">{data.lastSession.enrichedIntensity}/10</p>
                </div>
              )}
              {data.lastSession.performance?.averageHR != null && (
                <div>
                  <p className="text-zinc-500 text-xs">Avg HR</p>
                  <p className="text-white font-bold">{data.lastSession.performance.averageHR} bpm</p>
                </div>
              )}
              {data.lastSession.performance?.duration != null && (
                <div>
                  <p className="text-zinc-500 text-xs">Duration</p>
                  <p className="text-white font-bold">{minsToHM(data.lastSession.performance.duration)}</p>
                </div>
              )}
            </div>
            {(data.lastSession.sessionNotes?.parsed?.liftData?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {data.lastSession.sessionNotes!.parsed.liftData.slice(0, 4).map((lift, i) => (
                  <span
                    key={i}
                    className="text-xs bg-[#1A1A1A] text-zinc-400 px-2 py-0.5 rounded-full"
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
          <p className="text-zinc-600 text-xs">
            {updatedLabel ? `Updated ${updatedLabel}` : "Loading…"}
          </p>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="text-xs text-zinc-500 hover:text-[#00E5A0] transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
