"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import BottomNav from "@/components/BottomNav";
import type { FatigueSnapshot, FatigueSystemState, SleepState, RestingHRState } from "@/types";
import type { StoredActivity } from "@/lib/kv";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function systemBarColor(score: number): string {
  if (score < 40) return "bg-green-500";
  if (score < 65) return "bg-amber-500";
  if (score < 85) return "bg-orange-500";
  return "bg-red-500";
}

function systemTextColor(score: number): string {
  if (score < 40) return "text-green-600";
  if (score < 65) return "text-amber-600";
  if (score < 85) return "text-orange-600";
  return "text-red-600";
}

function overallBg(score: number): string {
  if (score >= 80) return "bg-green-50 border-green-200";
  if (score >= 60) return "bg-amber-50 border-amber-200";
  if (score >= 40) return "bg-orange-50 border-orange-200";
  return "bg-red-50 border-red-200";
}

function trendIcon(trend: FatigueSystemState["trend"]): string {
  if (trend === "improving") return "↑";
  if (trend === "worsening") return "↓";
  return "→";
}

function trendColor(trend: FatigueSystemState["trend"]): string {
  if (trend === "improving") return "text-green-600";
  if (trend === "worsening") return "text-red-500";
  return "text-gray-400";
}

function sleepScoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  if (score >= 40) return "text-orange-600";
  return "text-red-600";
}

function sleepScoreBar(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-amber-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
}

// ─── Circular gauge (SVG arc) ─────────────────────────────────────────────────

function CircularGauge({ score, emoji }: { score: number; emoji: string }) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const progress = (score / 100) * circumference;

  let strokeColor = "#ef4444";
  if (score >= 80) strokeColor = "#22c55e";
  else if (score >= 60) strokeColor = "#f59e0b";
  else if (score >= 40) strokeColor = "#f97316";

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg className="absolute" width="144" height="144" viewBox="0 0 144 144">
        {/* Track */}
        <circle cx="72" cy="72" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        {/* Progress arc */}
        <circle
          cx="72"
          cy="72"
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
          transform="rotate(-90 72 72)"
          style={{ transition: "stroke-dasharray 0.5s ease" }}
        />
      </svg>
      <div className="text-center z-10">
        <div className="text-2xl">{emoji}</div>
        <div className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{score}</div>
        <div className="text-xs text-gray-400">/100</div>
      </div>
    </div>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width={80} height={30}>
      <LineChart data={points}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── System card ──────────────────────────────────────────────────────────────

function SystemCard({
  icon,
  name,
  state,
  sparkColor,
}: {
  icon: string;
  name: string;
  state: FatigueSystemState;
  sparkColor: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-semibold text-gray-900">{name}</span>
        </div>
        <Sparkline data={[...state.history, state.score]} color={sparkColor} />
      </div>

      {/* Score bar */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full rounded-full transition-all ${systemBarColor(state.score)}`}
          style={{ width: `${state.freshness}%` }}
        />
      </div>

      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Freshness</p>
          <p className={`text-3xl font-bold tabular-nums leading-none ${systemTextColor(state.score)}`}>
            {state.freshness}
            <span className="text-base font-normal text-gray-400">%</span>
          </p>
        </div>
        <div className="text-right">
          <p className={`text-sm font-semibold ${trendColor(state.trend)}`}>
            {trendIcon(state.trend)} {state.trend.charAt(0).toUpperCase() + state.trend.slice(1)}
          </p>
          <p className="text-xs text-gray-400">
            {state.estimatedRecoveryHours > 0
              ? `Est. recovered in ${state.estimatedRecoveryHours}h`
              : "Recovered"}
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed truncate" title={state.primaryDriver}>
        {state.primaryDriver}
      </p>
    </div>
  );
}

// ─── Sleep card ───────────────────────────────────────────────────────────────

function SleepCard({
  sleep,
  onLogSleep,
}: {
  sleep: SleepState;
  onLogSleep: (hours: number) => Promise<void>;
}) {
  const [hours, setHours] = useState(7.5);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onLogSleep(hours);
    } finally {
      setSubmitting(false);
    }
  }

  const rows = [
    { label: "Last night", h: sleep.lastNight?.hours ?? null, score: sleep.lastNightScore },
    { label: "3-day avg",  h: sleep.rolling3DayAvgHours,      score: sleep.rolling3DayScore },
    { label: "7-day avg",  h: sleep.rolling7DayAvgHours,      score: sleep.rolling7DayScore },
  ];

  const sparkData = sleep.history.map((v) => v ?? 0);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">😴</span>
          <span className="text-sm font-semibold text-gray-900">Sleep</span>
          {sleep.trend && (
            <span className={`text-xs font-medium ${trendColor(sleep.trend)}`}>
              {trendIcon(sleep.trend)} {sleep.trend.charAt(0).toUpperCase() + sleep.trend.slice(1)}
            </span>
          )}
        </div>
        {sparkData.some((v) => v > 0) && (
          <Sparkline data={sparkData} color="#6366f1" />
        )}
      </div>

      <div className="space-y-2 mb-1">
        {rows.map(({ label, h, score }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-20 shrink-0">{label}</span>
            {h != null ? (
              <>
                <span className="text-xs font-medium text-gray-700 w-10 shrink-0 tabular-nums">
                  {h.toFixed(1)}h
                </span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${score != null ? sleepScoreBar(score) : "bg-gray-300"}`}
                    style={{ width: `${score ?? 0}%` }}
                  />
                </div>
                <span className={`text-xs font-semibold tabular-nums w-7 text-right ${score != null ? sleepScoreColor(score) : "text-gray-400"}`}>
                  {score ?? "–"}
                </span>
              </>
            ) : (
              <span className="text-xs text-gray-300 flex-1">No data</span>
            )}
          </div>
        ))}
      </div>

      {sleep.lastNight === null && (
        <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
          <span className="text-xs text-gray-500 shrink-0">Log last night:</span>
          <input
            type="number"
            min={0}
            max={14}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(parseFloat(e.target.value) || 0)}
            className="w-14 text-sm text-center border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <span className="text-xs text-gray-400">hrs</span>
          <button
            type="submit"
            disabled={submitting}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Resting HR card ──────────────────────────────────────────────────────────

function RestingHRCard({ restingHR }: { restingHR: RestingHRState }) {
  const sparkData = restingHR.history.map((v) => v ?? 0);
  const hasData = sparkData.some((v) => v > 0);

  function trendLabel(trend: RestingHRState["trend"]) {
    if (trend === "improving") return { text: "↓ Dropping", cls: "text-green-600" };
    if (trend === "worsening") return { text: "↑ Rising", cls: "text-red-500" };
    return { text: "→ Stable", cls: "text-gray-400" };
  }

  const tl = trendLabel(restingHR.trend);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">❤️</span>
          <span className="text-sm font-semibold text-gray-900">Resting HR</span>
          {hasData && (
            <span className={`text-xs font-medium ${tl.cls}`}>{tl.text}</span>
          )}
        </div>
        {hasData && <Sparkline data={sparkData} color="#ef4444" />}
      </div>

      <div className="flex items-end gap-4">
        <div>
          <span className="text-3xl font-bold tabular-nums text-gray-900">
            {restingHR.todayBpm ?? "–"}
          </span>
          <span className="text-sm text-gray-400 ml-1">bpm today</span>
        </div>
        {restingHR.rolling7DayAvgBpm != null && (
          <div className="pb-1">
            <span className="text-sm text-gray-500">
              7-day avg: <span className="font-medium text-gray-700">{restingHR.rolling7DayAvgBpm} bpm</span>
            </span>
          </div>
        )}
      </div>

      {!hasData && (
        <p className="text-xs text-gray-400 mt-2">
          No data yet — iOS Shortcut will populate this each morning.
        </p>
      )}
    </div>
  );
}

// ─── CTL/ATL/TSB chart ────────────────────────────────────────────────────────

interface PmcPoint {
  date: string;
  atl: number;
  ctl: number;
  tsb: number;
}

function buildPmc(activities: StoredActivity[]): PmcPoint[] {
  const today = new Date();
  const days: { date: string; stress: number }[] = [];

  // Build 42 days of daily stress scores (need CTL window)
  for (let i = 41; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = isoDate(d);
    const dayActivities = activities.filter((a) => a.start_date.startsWith(dateStr));
    const stress = dayActivities.reduce((sum, a) => {
      return sum + (a.suffer_score ?? 0);
    }, 0);
    days.push({ date: dateStr, stress });
  }

  let atl = 0;
  let ctl = 0;
  const kAtl = 2 / 8;   // 7-day EMA
  const kCtl = 2 / 43;  // 42-day EMA

  const result: PmcPoint[] = [];

  for (const day of days) {
    atl = atl + kAtl * (day.stress - atl);
    ctl = ctl + kCtl * (day.stress - ctl);
    result.push({
      date: day.date.substring(5), // MM-DD
      atl: Math.round(atl * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
    });
  }

  // Return last 14 days
  return result.slice(-14);
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReadinessPage() {
  const { status } = useSession();
  const router = useRouter();

  const [snapshot, setSnapshot] = useState<FatigueSnapshot | null>(null);
  const [activities, setActivities] = useState<StoredActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [host, setHost] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  useEffect(() => {
    setHost(window.location.origin);
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    Promise.all([
      fetch("/api/readiness").then((r) => r.ok ? r.json() : null),
      fetch("/api/sync/status").then((r) => r.ok ? r.json() : null),
    ]).then(([readiness, syncStatus]) => {
      if (readiness) {
        setSnapshot(readiness);
        setLastUpdated(readiness.date);
      }
      if (syncStatus?.recentActivities) {
        setActivities(syncStatus.recentActivities);
      }
    }).finally(() => setLoading(false));
  }, [status]);

  async function handleRecalculate() {
    setRecalculating(true);
    try {
      const res = await fetch("/api/fatigue/recalculate", { method: "POST" });
      if (res.ok) {
        const { snapshot: fresh } = await res.json();
        setSnapshot(fresh);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } finally {
      setRecalculating(false);
    }
  }

  async function handleLogSleep(hours: number) {
    const res = await fetch("/api/health/sleep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours, source: "manual" }),
    });
    if (res.ok) {
      // Trigger a recalculate so the snapshot reflects the new sleep data
      const recalc = await fetch("/api/fatigue/recalculate", { method: "POST" });
      if (recalc.ok) {
        const { snapshot: fresh } = await recalc.json();
        setSnapshot(fresh);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    }
  }

  const pmcData = buildPmc(activities);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-gray-50/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-gray-500 hover:text-gray-900 transition-colors text-lg">
              ←
            </Link>
            <span className="font-bold text-gray-900 text-lg">Readiness</span>
          </div>
          {lastUpdated && (
            <span className="text-xs text-gray-400">Updated {lastUpdated}</span>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && snapshot && (
          <>
            {/* Overall section */}
            <div className={`rounded-2xl border p-5 ${overallBg(snapshot.overall.score)}`}>
              <div className="flex items-center gap-5">
                <CircularGauge score={snapshot.overall.score} emoji={snapshot.overall.verdictEmoji} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 capitalize mb-1">
                    {snapshot.overall.verdict === "ready" ? "Ready to train" :
                     snapshot.overall.verdict === "moderate" ? "Moderate fatigue" :
                     snapshot.overall.verdict === "caution" ? "Caution" : "Rest day"}
                  </p>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {snapshot.overall.recommendation}
                  </p>

                  {/* HRV / sleep chips */}
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {snapshot.overall.hrvScore != null && (
                      <span className="text-xs bg-white/70 border border-gray-200 rounded-full px-2 py-0.5 text-gray-600">
                        ❤️ HRV est. {snapshot.overall.hrvScore}
                      </span>
                    )}
                    {snapshot.overall.sleepScore != null && (
                      <span className="text-xs bg-white/70 border border-gray-200 rounded-full px-2 py-0.5 text-gray-600">
                        😴 Sleep {snapshot.overall.sleepScore}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Sleep card */}
            {snapshot.sleep && (
              <SleepCard sleep={snapshot.sleep} onLogSleep={handleLogSleep} />
            )}

            {/* Resting HR card */}
            {snapshot.restingHR && (
              <RestingHRCard restingHR={snapshot.restingHR} />
            )}

            {/* Three system cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <SystemCard
                icon="💪"
                name="Neuromuscular"
                state={snapshot.neuromuscular}
                sparkColor="#6366f1"
              />
              <SystemCard
                icon="❤️"
                name="Cardiovascular"
                state={snapshot.cardiovascular}
                sparkColor="#ef4444"
              />
              <SystemCard
                icon="⚡"
                name="Metabolic"
                state={snapshot.metabolic}
                sparkColor="#f59e0b"
              />
            </div>

            {/* CTL/ATL/TSB performance management chart */}
            {pmcData.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
                  Performance Management (14 days)
                </h2>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={pmcData}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                      tickLine={false}
                      axisLine={false}
                      interval={3}
                    />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
                        backgroundColor: "#fff",
                      }}
                    />
                    <Legend
                      iconType="line"
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="ctl"
                      name="CTL (fitness)"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="atl"
                      name="ATL (fatigue)"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="tsb"
                      name="TSB (form)"
                      stroke="#22c55e"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-gray-400 mt-1">
                  Based on Strava effort scores. TSB = CTL − ATL (positive = fresh, negative = fatigued).
                </p>
              </div>
            )}

            {/* Apple Health / iOS Shortcut setup — only shown when no sleep synced */}
            {snapshot.sleep?.lastNight == null && (
              <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">📱</span>
                  <span className="text-sm font-semibold text-gray-900">Auto-sync sleep via iOS Shortcut</span>
                </div>
                <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                  Build an iOS Shortcut that runs at wake-up to automatically log your sleep from Apple Health.
                </p>
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3">
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
                <details className="group">
                  <summary className="cursor-pointer text-xs font-medium text-gray-700 list-none flex items-center gap-1">
                    <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                    Shortcut steps
                  </summary>
                  <ol className="mt-2 space-y-1 text-xs text-gray-500 list-decimal list-inside leading-relaxed">
                    <li>Get Today&apos;s Date → format as YYYY-MM-DD</li>
                    <li>Get Health Samples → Sleep Analysis, Yesterday 8 PM to Now</li>
                    <li>Filter samples where Category Value is Asleep</li>
                    <li>Calculate Statistics → Sum of Duration</li>
                    <li>Divide duration by 3600 to convert to hours</li>
                    <li>Make Web Request → POST {host}/api/health/sleep</li>
                    <li>Set header: <code className="bg-gray-100 rounded px-1">Authorization: Bearer [HEALTH_SYNC_SECRET]</code></li>
                    <li>Body (JSON): <code className="bg-gray-100 rounded px-1">{`{"date":"[Date]","hours":[Hours]}`}</code></li>
                    <li>Set as a Personal Automation triggered by Wake Up Alarm</li>
                  </ol>
                  <p className="mt-2 text-xs text-gray-400">
                    Set <code className="bg-gray-100 rounded px-1">HEALTH_SYNC_SECRET</code> in your Vercel environment variables and use that value as the Bearer token.
                  </p>
                </details>
              </div>
            )}

            {/* Recalculate + last sync */}
            <div className="flex items-center justify-between px-1">
              <p className="text-xs text-gray-400">
                Scores update automatically after each Strava sync.
              </p>
              <button
                onClick={handleRecalculate}
                disabled={recalculating}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50"
              >
                {recalculating ? "Recalculating…" : "Recalculate now"}
              </button>
            </div>
          </>
        )}

        {!loading && !snapshot && (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
            <p className="text-sm text-gray-500 mb-4">No fatigue data yet.</p>
            <button
              onClick={handleRecalculate}
              disabled={recalculating}
              className="text-sm px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              {recalculating ? "Calculating…" : "Calculate now"}
            </button>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
