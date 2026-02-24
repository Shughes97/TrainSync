"use client";

import type { ReadinessOutput } from "@/types";

interface ReadinessCardProps {
  readiness: ReadinessOutput;
}

function scoreColor(score: number): { ring: string; text: string; bg: string } {
  if (score >= 70) return { ring: "border-green-200", text: "text-green-700", bg: "bg-green-50" };
  if (score >= 40) return { ring: "border-amber-200", text: "text-amber-700", bg: "bg-amber-50" };
  return { ring: "border-red-200", text: "text-red-700", bg: "bg-red-50" };
}

function scoreLabel(score: number): string {
  if (score >= 80) return "High";
  if (score >= 60) return "Good";
  if (score >= 40) return "Moderate";
  if (score >= 20) return "Low";
  return "Very Low";
}

export default function ReadinessCard({ readiness }: ReadinessCardProps) {
  const { score, lastSessionSummary, consecutiveNeuromuscularPenalty } = readiness;
  const { ring, text, bg } = scoreColor(score);

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${bg} ${ring}`}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-900">Readiness</h2>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${text}`}>{scoreLabel(score)}</span>
          <span className={`text-2xl font-bold tabular-nums ${text}`}>{score}</span>
          <span className="text-xs text-gray-400">/100</span>
        </div>
      </div>

      {/* Score bar */}
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full rounded-full transition-all ${
            score >= 70 ? "bg-green-500" : score >= 40 ? "bg-amber-500" : "bg-red-500"
          }`}
          style={{ width: `${score}%` }}
        />
      </div>

      <p className="text-xs text-gray-600 leading-relaxed">{lastSessionSummary}</p>

      {consecutiveNeuromuscularPenalty && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
          ⚠ Two consecutive high-intensity strength sessions — prioritise recovery today.
        </p>
      )}
    </div>
  );
}
