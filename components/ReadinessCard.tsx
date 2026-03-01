"use client";

import Link from "next/link";
import type { FatigueSnapshot } from "@/types";

interface ReadinessCardProps {
  readiness: FatigueSnapshot;
}

function overallColor(score: number): { text: string; bar: string } {
  if (score >= 80) return { text: "text-green-700", bar: "bg-green-500" };
  if (score >= 60) return { text: "text-amber-600", bar: "bg-amber-500" };
  if (score >= 40) return { text: "text-orange-600", bar: "bg-orange-500" };
  return { text: "text-red-600", bar: "bg-red-500" };
}

function systemColor(score: number): string {
  if (score < 40) return "text-green-600";
  if (score < 65) return "text-amber-600";
  if (score < 85) return "text-orange-600";
  return "text-red-600";
}

export default function ReadinessCard({ readiness }: ReadinessCardProps) {
  const { overall, neuromuscular, cardiovascular, metabolic } = readiness;
  const { text, bar } = overallColor(overall.score);

  return (
    <Link href="/readiness" className="block">
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:border-indigo-200 transition-colors">
        {/* Top row: emoji + overall + three system scores */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{overall.verdictEmoji}</span>
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Readiness</span>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold tabular-nums ${text}`}>{overall.score}</span>
                <span className="text-xs text-gray-400">/100</span>
              </div>
            </div>
          </div>

          {/* Three system scores */}
          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-[10px] text-gray-400 mb-0.5">💪</p>
              <p className={`text-sm font-semibold tabular-nums ${systemColor(neuromuscular.score)}`}>
                {100 - neuromuscular.score}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-400 mb-0.5">❤️</p>
              <p className={`text-sm font-semibold tabular-nums ${systemColor(cardiovascular.score)}`}>
                {100 - cardiovascular.score}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-400 mb-0.5">⚡</p>
              <p className={`text-sm font-semibold tabular-nums ${systemColor(metabolic.score)}`}>
                {100 - metabolic.score}
              </p>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
          <div
            className={`h-full rounded-full transition-all ${bar}`}
            style={{ width: `${overall.score}%` }}
          />
        </div>

        {/* Recommendation */}
        <p className="text-xs text-gray-600 leading-relaxed">{overall.recommendation}</p>

        <p className="text-[10px] text-indigo-500 mt-2">Tap for details →</p>
      </div>
    </Link>
  );
}
