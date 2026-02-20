"use client";

import { useState } from "react";
import type { WorkoutSession } from "@/types";
import { formatDay } from "@/lib/scheduler";

interface TimePickerModalProps {
  session: WorkoutSession;
  onConfirm: (id: string, startTime: string) => void;
  onClose: () => void;
}

// Weekday morning: 6:30–8am; latest start 7:00 for 1hr session
const MORNING_SLOTS_WEEKDAY = ["06:30", "07:00"];
// Weekend morning: 8:00am–12pm; latest start 11:00 for 1hr session
const MORNING_SLOTS_WEEKEND = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00",
];
const EVENING_SLOTS = ["17:00", "17:30", "18:00", "18:30", "19:00"];

function formatSlot(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

export default function TimePickerModal({
  session,
  onConfirm,
  onClose,
}: TimePickerModalProps) {
  const [selected, setSelected] = useState(session.startTime);

  const dow = new Date(session.day + "T12:00:00").getDay();
  const isWeekend = dow === 0 || dow === 6;
  const morningSlots = isWeekend ? MORNING_SLOTS_WEEKEND : MORNING_SLOTS_WEEKDAY;
  const morningLabel = isWeekend ? "Morning (8am–12pm)" : "Morning (6:30–8am)";

  const allSlots = [
    { label: morningLabel, slots: morningSlots },
    { label: "Evening (5–8pm)", slots: EVENING_SLOTS },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative z-10 w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-t-3xl sm:rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-semibold text-white">Change Time</h3>
            <p className="text-sm text-zinc-400">{formatDay(session.day)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {allSlots.map(({ label, slots }) => (
          <div key={label} className="mb-5">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
              {label}
            </p>
            <div className={`grid gap-2 ${slots.length <= 2 ? "grid-cols-2" : slots.length <= 6 ? "grid-cols-3" : "grid-cols-4"}`}>
              {slots.map((slot) => (
                <button
                  key={slot}
                  onClick={() => setSelected(slot)}
                  className={`
                    py-2.5 rounded-xl text-sm font-medium transition-all
                    ${
                      selected === slot
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }
                  `}
                >
                  {formatSlot(slot)}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button
          onClick={() => onConfirm(session.id, selected)}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors"
        >
          Confirm Time
        </button>
      </div>
    </div>
  );
}
