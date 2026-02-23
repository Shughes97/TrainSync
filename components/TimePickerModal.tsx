"use client";

import { useMemo, useState } from "react";
import type { CalEvent, WorkoutSession } from "@/types";
import { formatDay } from "@/lib/scheduler";
import DayPreview from "@/components/DayPreview";

export interface WeekDay {
  iso: string;   // YYYY-MM-DD
  label: string; // "Mon", "Tue", …
  date: number;  // day-of-month
  disabled: boolean;
}

interface TimePickerModalProps {
  session: WorkoutSession;
  onConfirm: (id: string, startTime: string, day?: string) => void;
  onClose: () => void;
  /** When true, shows a day-of-week selector above the time slots */
  showDayPicker?: boolean;
  /** Days for the current week, built by the parent */
  weekDays?: WeekDay[];
  /** Full-week calendar events keyed by YYYY-MM-DD — enables the live day preview */
  calEventsByDay?: Record<string, CalEvent[]>;
}

const MORNING_SLOTS_WEEKDAY = ["06:30", "07:00"];
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

function isWeekendDay(iso: string): boolean {
  const dow = new Date(iso + "T12:00:00").getDay();
  return dow === 0 || dow === 6;
}

export default function TimePickerModal({
  session,
  onConfirm,
  onClose,
  showDayPicker = false,
  weekDays = [],
  calEventsByDay,
}: TimePickerModalProps) {
  const [selectedDay, setSelectedDay] = useState(session.day);
  const [selectedTime, setSelectedTime] = useState(session.startTime);

  const previewSession = useMemo((): WorkoutSession => {
    const [h, m] = selectedTime.split(":").map(Number);
    const endHour = h + 1;
    const endTime = `${endHour.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    return {
      ...session,
      day: selectedDay,
      startTime: selectedTime,
      endTime,
      startISO: `${selectedDay}T${selectedTime}:00`,
      endISO: `${selectedDay}T${endTime}:00`,
      window: h < 12 ? "morning" : "evening",
    };
  }, [session, selectedDay, selectedTime]);

  const isWeekend = isWeekendDay(selectedDay);
  const morningSlots = isWeekend ? MORNING_SLOTS_WEEKEND : MORNING_SLOTS_WEEKDAY;
  const morningLabel = isWeekend ? "Morning (8am–12pm)" : "Morning (6:30–8am)";

  const allSlots = [
    { label: morningLabel, slots: morningSlots },
    { label: "Evening (5–8pm)", slots: EVENING_SLOTS },
  ];

  function handleDayChange(iso: string) {
    setSelectedDay(iso);
    // Reset time if the current selection isn't valid for the new day's slots
    const newIsWeekend = isWeekendDay(iso);
    const newMorning = newIsWeekend ? MORNING_SLOTS_WEEKEND : MORNING_SLOTS_WEEKDAY;
    const allValid = [...newMorning, ...EVENING_SLOTS];
    if (!allValid.includes(selectedTime)) {
      setSelectedTime(newMorning[0]);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-sm bg-white border border-gray-200 rounded-t-3xl sm:rounded-3xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Change {showDayPicker ? "Date & Time" : "Time"}
            </h3>
            <p className="text-sm text-gray-500">{formatDay(selectedDay)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Day picker */}
        {showDayPicker && weekDays.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Day
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {weekDays.map((day) => {
                const isSelected = day.iso === selectedDay;
                return (
                  <button
                    key={day.iso}
                    onClick={() => !day.disabled && handleDayChange(day.iso)}
                    disabled={day.disabled}
                    className={`flex-shrink-0 flex flex-col items-center px-2.5 py-2 rounded-xl text-xs font-medium transition-all border ${
                      isSelected
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : day.disabled
                        ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed"
                        : "bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200"
                    }`}
                  >
                    <span className="text-[10px] uppercase tracking-wide">{day.label}</span>
                    <span className="text-sm font-bold leading-tight mt-0.5">{day.date}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Live day preview */}
        {calEventsByDay && (
          <div className="mb-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Day Preview
            </p>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 pt-1 pb-2">
              <DayPreview
                session={previewSession}
                events={calEventsByDay[selectedDay] ?? []}
              />
            </div>
          </div>
        )}

        {/* Time slots */}
        {allSlots.map(({ label, slots }) => (
          <div key={label} className="mb-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              {label}
            </p>
            <div className={`grid gap-2 ${slots.length <= 2 ? "grid-cols-2" : slots.length <= 6 ? "grid-cols-3" : "grid-cols-4"}`}>
              {slots.map((slot) => (
                <button
                  key={slot}
                  onClick={() => setSelectedTime(slot)}
                  className={`py-2.5 rounded-xl text-sm font-medium transition-all ${
                    selectedTime === slot
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {formatSlot(slot)}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button
          onClick={() => onConfirm(session.id, selectedTime, showDayPicker ? selectedDay : undefined)}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
