"use client";

import { useState } from "react";
import type { OpenGymSuggestion } from "@/types";

interface OpenGymCardProps {
  suggestion: OpenGymSuggestion;
}

export default function OpenGymCard({ suggestion }: OpenGymCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">💡</span>
          <span className="text-xs font-semibold text-gray-800">
            Suggested: {suggestion.focus}
          </span>
        </div>
        <span className="text-gray-400 text-[10px] ml-2 flex-shrink-0">
          {expanded ? "▲ hide" : "▼ show"}
        </span>
      </button>

      {expanded && (
        <div className="bg-white px-3 pt-2 pb-3 space-y-1.5">
          {suggestion.exercises.map((ex, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-xs text-gray-700">{ex.name}</span>
              <span className="text-xs text-gray-500 font-mono tabular-nums">
                {ex.sets}
              </span>
            </div>
          ))}
          <p className="text-[10px] text-gray-500 italic border-t border-gray-200 pt-2 mt-1 leading-relaxed">
            {suggestion.note}
          </p>
        </div>
      )}
    </div>
  );
}
