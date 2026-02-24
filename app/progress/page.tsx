"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import BottomNav from "@/components/BottomNav";

type ViewMode = "weekly" | "monthly";

interface DayBar {
  label: string;
  date: string;
  bikeH: number;
  runH: number;
  crossfitH: number;
  strengthH: number;
}

interface WeekBar {
  label: string;
  weekStart: string;
  bikeH: number;
  runH: number;
  crossfitH: number;
  strengthH: number;
}

const COLORS = {
  bikeH: "#3b82f6",      // blue-500
  runH: "#e11d48",       // rose-600
  crossfitH: "#f97316",  // orange-500
  strengthH: "#d97706",  // amber-600
};

const LABELS = {
  bikeH: "Cycling",
  runH: "Running",
  crossfitH: "CrossFit",
  strengthH: "Strength",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: { value: number }) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-500 font-medium mb-1">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) =>
        p.value > 0 ? (
          <p key={p.name} style={{ color: p.color }}>
            {LABELS[p.name as keyof typeof LABELS]}: {p.value}h
          </p>
        ) : null
      )}
      {total > 0 && (
        <p className="text-gray-700 font-semibold mt-1 border-t border-gray-300 pt-1">
          Total: {Math.round(total * 10) / 10}h
        </p>
      )}
    </div>
  );
}

export default function ProgressPage() {
  const { status } = useSession();
  const router = useRouter();

  const [mode, setMode] = useState<ViewMode>("weekly");
  const [weeklyData, setWeeklyData] = useState<DayBar[]>([]);
  const [monthlyData, setMonthlyData] = useState<WeekBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    setLoading(true);
    fetch("/api/progress")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then((d) => {
        setWeeklyData(d.weekly ?? []);
        setMonthlyData(d.monthly ?? []);
      })
      .catch(() => setError("Could not load progress data."))
      .finally(() => setLoading(false));
  }, [status]);

  const data = mode === "weekly" ? weeklyData : monthlyData;

  // Shorten labels for the chart x-axis
  const chartData = data.map((d) => ({
    ...d,
    label: mode === "weekly"
      ? d.label.split(" ").slice(0, 2).join(" ")  // "Mon 16"
      : d.label,                                   // "16 Feb"
  }));

  const hasData = data.some(
    (d) => d.bikeH > 0 || d.runH > 0 || d.crossfitH > 0 || d.strengthH > 0
  );

  if (status === "loading" || (loading && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-gray-50/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <span className="font-bold text-gray-900 text-lg">Progress</span>
          {/* Toggle */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1">
            <button
              onClick={() => setMode("weekly")}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                mode === "weekly"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Last 14 days
            </button>
            <button
              onClick={() => setMode("monthly")}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                mode === "monthly"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Last 12 weeks
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* Chart card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-4 uppercase tracking-widest font-semibold">
            {mode === "weekly" ? "Daily training hours" : "Weekly training hours"}
          </p>

          {!hasData ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <p className="text-gray-500 text-sm">No activity data yet.</p>
              <p className="text-gray-400 text-xs">Sync Strava to see your training history.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={chartData}
                margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                barCategoryGap="20%"
              >
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#71717a", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval={mode === "weekly" ? 1 : 0}
                />
                <YAxis
                  tick={{ fill: "#71717a", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  unit="h"
                  allowDecimals
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="bikeH" name="bikeH" stackId="a" fill={COLORS.bikeH} radius={[0, 0, 0, 0]} />
                <Bar dataKey="runH" name="runH" stackId="a" fill={COLORS.runH} radius={[0, 0, 0, 0]} />
                <Bar dataKey="crossfitH" name="crossfitH" stackId="a" fill={COLORS.crossfitH} radius={[0, 0, 0, 0]} />
                <Bar dataKey="strengthH" name="strengthH" stackId="a" fill={COLORS.strengthH} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Legend */}
        <div className="grid grid-cols-2 gap-2">
          {(["bikeH", "runH", "crossfitH", "strengthH"] as const).map((key) => {
            const total = data.reduce((s, d) => s + (d[key] ?? 0), 0);
            return (
              <div
                key={key}
                className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 flex items-center gap-2.5"
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: COLORS[key] }}
                />
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">{LABELS[key]}</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {Math.round(total * 10) / 10}h
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
