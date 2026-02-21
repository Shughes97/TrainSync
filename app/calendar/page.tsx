"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import BottomNav from "@/components/BottomNav";
import TimePickerModal from "@/components/TimePickerModal";
import { getWeekStart } from "@/lib/scheduler";
import type { WorkoutSession } from "@/types";

interface CalEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TYPE_MAP: Record<string, string> = {
  CrossFit: "Crossfit",
  Strength: "Strength",
  Run: "Run",
  Bike: "Bike",
};

const EMOJI_MAP: Record<string, string> = {
  Crossfit: "🏋️",
  Strength: "💪",
  Run: "🏃",
  Bike: "🚴",
};

function parseType(summary: string): string {
  for (const [key, val] of Object.entries(TYPE_MAP)) {
    if (summary.includes(key)) return val;
  }
  return "Crossfit";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

function weekStartForOffset(offset: number): Date {
  const base = getWeekStart();
  base.setDate(base.getDate() + offset * 7);
  return base;
}

function weekLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function isoDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

export default function CalendarPage() {
  const { status } = useSession();
  const router = useRouter();

  const [weekOffset, setWeekOffset] = useState(0);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<{ event: CalEvent; session: WorkoutSession } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  const monday = weekStartForOffset(weekOffset);
  const weekStartISO = isoDateStr(monday);

  const loadEvents = useCallback(async (weekStart: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar?weekStart=${weekStart}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setError("Could not load calendar sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") loadEvents(weekStartISO);
  }, [status, weekStartISO, loadEvents]);

  async function handleDelete(eventId: string) {
    setDeletingId(eventId);
    try {
      const res = await fetch(`/api/calendar/${eventId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setConfirmDeleteId(null);
    } catch {
      setError("Failed to delete session.");
    } finally {
      setDeletingId(null);
    }
  }

  function openEdit(event: CalEvent) {
    const dayStr = event.start.substring(0, 10);
    const startH = new Date(event.start).getHours();
    const startM = new Date(event.start).getMinutes();
    const endH = new Date(event.end).getHours();
    const endM = new Date(event.end).getMinutes();
    const startTime = `${startH.toString().padStart(2, "0")}:${startM.toString().padStart(2, "0")}`;
    const endTime = `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
    const type = parseType(event.summary) as WorkoutSession["type"];

    const ws: WorkoutSession = {
      id: event.id,
      type,
      day: dayStr,
      startTime,
      endTime,
      startISO: event.start,
      endISO: event.end,
      window: startH < 12 ? "morning" : "evening",
    };
    setEditingEvent({ event, session: ws });
  }

  async function handleTimeConfirm(id: string, startTime: string) {
    if (!editingEvent) return;
    const [h, m] = startTime.split(":").map(Number);
    const endH = h + 1;
    const endTime = `${endH.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    const dayStr = editingEvent.session.day;
    const startISO = `${dayStr}T${startTime}:00`;
    const endISO = `${dayStr}T${endTime}:00`;

    try {
      const res = await fetch(`/api/calendar/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startISO, endISO }),
      });
      if (!res.ok) throw new Error("Update failed");
      setEvents((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, start: startISO, end: endISO } : e
        )
      );
    } catch {
      setError("Failed to update session time.");
    }
    setEditingEvent(null);
  }

  // Build day → events map
  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const eventsByDay: Record<string, CalEvent[]> = {};
  for (const e of events) {
    const day = e.start.substring(0, 10);
    if (!eventsByDay[day]) eventsByDay[day] = [];
    eventsByDay[day].push(e);
  }

  if (status === "loading" || (loading && events.length === 0)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur border-b border-zinc-800/60">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <span className="font-bold text-white text-lg">Calendar</span>
        </div>
        {/* Week navigation */}
        <div className="max-w-lg mx-auto px-4 pb-3 flex items-center justify-between gap-2">
          <button
            onClick={() => setWeekOffset((o) => o - 1)}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Previous week"
          >
            ←
          </button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-white">{weekLabel(monday)}</span>
            {weekOffset !== 0 && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-xs text-indigo-400 hover:text-indigo-300 mt-0.5"
              >
                Back to this week
              </button>
            )}
            {weekOffset === 0 && (
              <span className="text-xs text-zinc-500 mt-0.5">This week</span>
            )}
          </div>
          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Next week"
          >
            →
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-500 text-sm">No sessions scheduled this week.</p>
            <p className="text-zinc-600 text-xs mt-1">
              Go to Schedule to propose and add sessions.
            </p>
          </div>
        ) : (
          days.map((day, i) => {
            const dayStr = isoDateStr(day);
            const dayEvents = eventsByDay[dayStr] ?? [];
            const isToday = dayStr === isoDateStr(new Date());

            return (
              <div key={dayStr} className={`rounded-2xl border p-4 ${
                isToday
                  ? "bg-indigo-950/30 border-indigo-500/30"
                  : "bg-zinc-900 border-zinc-800"
              }`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${
                    isToday ? "text-indigo-400" : "text-zinc-500"
                  }`}>
                    {DAYS[i]}
                  </span>
                  <span className={`text-sm font-bold ${
                    isToday ? "text-indigo-300" : "text-zinc-300"
                  }`}>
                    {day.getDate()}
                  </span>
                  {isToday && (
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-full">
                      Today
                    </span>
                  )}
                </div>

                {dayEvents.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic">No sessions</p>
                ) : (
                  <div className="space-y-2">
                    {dayEvents.map((event) => {
                      const type = parseType(event.summary);
                      const isConfirming = confirmDeleteId === event.id;
                      const isDeleting = deletingId === event.id;

                      return (
                        <div
                          key={event.id}
                          className="flex items-center justify-between bg-zinc-800/60 rounded-xl px-3 py-2.5"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-lg flex-shrink-0">
                              {EMOJI_MAP[type] ?? "🏅"}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-200 truncate">
                                {event.summary.replace(/^[^\w]+/, "").trim()}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {formatTime(event.start)} – {formatTime(event.end)}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            {isConfirming ? (
                              <>
                                <button
                                  onClick={() => handleDelete(event.id)}
                                  disabled={isDeleting}
                                  className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                                >
                                  {isDeleting ? "…" : "Confirm"}
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-xs px-2 py-1 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => openEdit(event)}
                                  className="text-xs px-2 py-1 rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(event.id)}
                                  className="text-xs px-2 py-1 rounded-lg bg-zinc-700 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>

      {editingEvent && (
        <TimePickerModal
          session={editingEvent.session}
          onConfirm={handleTimeConfirm}
          onClose={() => setEditingEvent(null)}
        />
      )}

      <BottomNav />
    </div>
  );
}
