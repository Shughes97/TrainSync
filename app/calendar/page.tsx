"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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

// ─── Constants ─────────────────────────────────────────────────────────────────
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_START = 6;
const HOUR_END = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const HOUR_PX = 64;
const GRID_H = TOTAL_HOURS * HOUR_PX;
const TIME_COL_W = 40;

const TYPE_MAP: Record<string, string> = {
  CrossFit: "Crossfit",
  Strength: "Strength",
  Run: "Run",
  Bike: "Bike",
};

const TYPE_COLORS: Record<string, string> = {
  Crossfit: "#ea580c",
  Strength: "#9333ea",
  Run: "#e11d48",
  Bike: "#2563eb",
};

const EMOJI_MAP: Record<string, string> = {
  Crossfit: "🏋️",
  Strength: "💪",
  Run: "🏃",
  Bike: "🚴",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
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

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
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
  // Use local date parts (not .toISOString which is UTC) so the Monday
  // boundary is always correct regardless of the user's timezone.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function topPct(iso: string): number {
  const d = new Date(iso);
  const h = d.getHours() + d.getMinutes() / 60;
  const clamped = Math.max(HOUR_START, Math.min(HOUR_END, h));
  return ((clamped - HOUR_START) / TOTAL_HOURS) * 100;
}

function heightPct(startISO: string, endISO: string): number {
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  const dh = Math.max(0.25, (e - s) / 3_600_000);
  return (Math.min(dh, TOTAL_HOURS) / TOTAL_HOURS) * 100;
}

function isVisible(event: CalEvent): boolean {
  const startH = new Date(event.start).getHours() + new Date(event.start).getMinutes() / 60;
  const endH = new Date(event.end).getHours() + new Date(event.end).getMinutes() / 60;
  return startH < HOUR_END && endH > HOUR_START;
}

// Two-column overlap layout
function layoutEvents(
  events: CalEvent[]
): Array<{ event: CalEvent; leftPct: number; widthPct: number }> {
  const sorted = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
  const result: Array<{
    event: CalEvent;
    leftPct: number;
    widthPct: number;
    endMs: number;
  }> = [];

  for (const event of sorted) {
    const startMs = new Date(event.start).getTime();
    const endMs = new Date(event.end).getTime();
    const overlapping = result.filter(
      (r) => startMs < r.endMs && endMs > new Date(r.event.start).getTime()
    );
    if (overlapping.length === 0) {
      result.push({ event, leftPct: 0, widthPct: 100, endMs });
    } else {
      const usedLeft = new Set(overlapping.map((r) => r.leftPct));
      const left = usedLeft.has(0) ? 50 : 0;
      // Shrink already-placed overlapping events to 50%
      for (const r of overlapping) {
        r.widthPct = 50;
      }
      result.push({ event, leftPct: left, widthPct: 50, endMs });
    }
  }

  return result.map(({ event, leftPct, widthPct }) => ({
    event,
    leftPct,
    widthPct,
  }));
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { status } = useSession();
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement>(null);

  const [weekOffset, setWeekOffset] = useState(0);
  const [trainSyncEvents, setTrainSyncEvents] = useState<CalEvent[]>([]);
  const [allEventsByDay, setAllEventsByDay] = useState<Record<string, CalEvent[]>>({});
  const [completedEventIds, setCompletedEventIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CalEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<{
    event: CalEvent;
    session: WorkoutSession;
  } | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
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
      setTrainSyncEvents(data.events ?? []);
      setAllEventsByDay(data.allEventsByDay ?? {});
      setCompletedEventIds(new Set(data.completedEventIds ?? []));
    } catch {
      setError("Could not load calendar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") loadEvents(weekStartISO);
  }, [status, weekStartISO, loadEvents]);

  // Scroll to current time (or 7am for other weeks)
  useEffect(() => {
    if (!gridRef.current || loading) return;
    const now = new Date();
    const scrollPx =
      weekOffset === 0 && now.getHours() >= HOUR_START
        ? Math.max(0, (now.getHours() + now.getMinutes() / 60 - HOUR_START - 1) * HOUR_PX)
        : 0;
    gridRef.current.scrollTo({ top: scrollPx });
  }, [loading, weekOffset]);

  async function handleDelete(eventId: string) {
    setDeletingId(eventId);
    try {
      const res = await fetch(`/api/calendar/${eventId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setTrainSyncEvents((prev) => prev.filter((e) => e.id !== eventId));
      setAllEventsByDay((prev) => {
        const next = { ...prev };
        for (const day in next) {
          next[day] = next[day].filter((e) => e.id !== eventId);
        }
        return next;
      });
      setConfirmDelete(null);
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
    const startTime = `${startH.toString().padStart(2, "0")}:${startM
      .toString()
      .padStart(2, "0")}`;
    const endTime = `${endH.toString().padStart(2, "0")}:${endM
      .toString()
      .padStart(2, "0")}`;
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
    setSelectedEvent(null);
  }

  async function handleTimeConfirm(id: string, startTime: string) {
    if (!editingEvent) return;
    const [h, m] = startTime.split(":").map(Number);
    const endH = h + 1;
    const endTime = `${endH.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}`;
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
      const updater = (e: CalEvent) =>
        e.id === id ? { ...e, start: startISO, end: endISO } : e;
      setTrainSyncEvents((prev) => prev.map(updater));
      setAllEventsByDay((prev) => {
        const next = { ...prev };
        for (const day in next) next[day] = next[day].map(updater);
        return next;
      });
    } catch {
      setError("Failed to update session time.");
    }
    setEditingEvent(null);
  }

  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const trainSyncIds = new Set(trainSyncEvents.map((e) => e.id));
  const todayStr = isoDateStr(new Date());
  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => HOUR_START + i);

  // Current time
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const nowInRange = nowHour >= HOUR_START && nowHour < HOUR_END;
  const nowPct = ((nowHour - HOUR_START) / TOTAL_HOURS) * 100;

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-gray-50" style={{ height: "100dvh" }}>
      {/* ── Sticky header ─────────────────────────────────────────────── */}
      <header className="flex-shrink-0 bg-gray-50 border-b border-gray-200 z-30">
        {/* Title + week nav */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-bold text-gray-900 text-lg">Calendar</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              aria-label="Previous week"
            >
              ←
            </button>
            <div className="flex flex-col items-center min-w-[120px]">
              <span className="text-sm font-medium text-gray-900">
                {weekLabel(monday)}
              </span>
              {weekOffset !== 0 ? (
                <button
                  onClick={() => setWeekOffset(0)}
                  className="text-xs text-indigo-600 hover:text-indigo-700 mt-0.5"
                >
                  This week
                </button>
              ) : (
                <span className="text-xs text-gray-400 mt-0.5">This week</span>
              )}
            </div>
            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              aria-label="Next week"
            >
              →
            </button>
          </div>
        </div>

        {/* Day column headers */}
        <div className="flex border-t border-gray-200">
          <div style={{ width: TIME_COL_W }} className="flex-shrink-0" />
          {days.map((day, i) => {
            const dayStr = isoDateStr(day);
            const isToday = dayStr === todayStr;
            return (
              <div
                key={dayStr}
                className={`flex-1 flex flex-col items-center py-1.5 ${
                  isToday ? "bg-indigo-50" : ""
                }`}
              >
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide ${
                    isToday ? "text-indigo-600" : "text-gray-500"
                  }`}
                >
                  {DAYS[i]}
                </span>
                <span
                  className={`text-sm font-bold leading-tight ${
                    isToday ? "text-white" : "text-gray-500"
                  }`}
                >
                  {day.getDate()}
                </span>
                {isToday && (
                  <div className="w-1 h-1 rounded-full bg-indigo-500 mt-0.5" />
                )}
              </div>
            );
          })}
        </div>
      </header>

      {/* ── Scrollable time grid ───────────────────────────────────────── */}
      <div
        ref={gridRef}
        className="flex-1 overflow-y-auto overflow-x-hidden pb-16"
      >
        {error && (
          <div className="mx-4 my-3 bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="relative flex" style={{ height: GRID_H }}>
            {/* Time labels */}
            <div
              className="flex-shrink-0 relative"
              style={{ width: TIME_COL_W }}
            >
              {hours.map((h, i) => (
                <div
                  key={h}
                  className="absolute flex items-start justify-end pr-2"
                  style={{ top: i * HOUR_PX - 7, width: TIME_COL_W }}
                >
                  <span className="text-[10px] text-gray-400 leading-none">
                    {hourLabel(h)}
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {days.map((day) => {
              const dayStr = isoDateStr(day);
              const isToday = dayStr === todayStr;
              const dayEvents = (allEventsByDay[dayStr] ?? []).filter(isVisible);
              const laid = layoutEvents(dayEvents);

              return (
                <div
                  key={dayStr}
                  className={`flex-1 relative border-l ${
                    isToday
                      ? "border-l-indigo-200 bg-indigo-50/40"
                      : "border-l-gray-200"
                  }`}
                >
                  {/* Hour lines */}
                  {hours.slice(0, -1).map((_, hi) => (
                    <div
                      key={hi}
                      className="absolute left-0 right-0 border-t border-gray-200"
                      style={{ top: hi * HOUR_PX }}
                    />
                  ))}
                  {/* Half-hour dashed lines */}
                  {hours.slice(0, -1).map((_, hi) => (
                    <div
                      key={`h${hi}`}
                      className="absolute left-0 right-0 border-t border-gray-200/20 border-dashed"
                      style={{ top: hi * HOUR_PX + HOUR_PX / 2 }}
                    />
                  ))}

                  {/* Current time indicator */}
                  {isToday && nowInRange && weekOffset === 0 && (
                    <div
                      className="absolute left-0 right-0 z-20 flex items-center pointer-events-none"
                      style={{ top: `${nowPct}%` }}
                    >
                      <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0" />
                      <div className="flex-1 h-px bg-red-500/70" />
                    </div>
                  )}

                  {/* Events */}
                  {laid.map(({ event, leftPct, widthPct }) => {
                    const isTS = trainSyncIds.has(event.id);
                    const isDone = isTS && completedEventIds.has(event.id);
                    const type = isTS ? parseType(event.summary) : null;
                    const color = type ? TYPE_COLORS[type] : null;
                    const top = topPct(event.start);
                    const height = heightPct(event.start, event.end);
                    const isSelected = selectedEvent?.id === event.id;

                    return (
                      <button
                        key={event.id}
                        onClick={() =>
                          isTS
                            ? setSelectedEvent(
                                isSelected ? null : event
                              )
                            : undefined
                        }
                        className="absolute overflow-hidden rounded-md text-left"
                        style={{
                          top: `${top}%`,
                          height: `${height}%`,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                      >
                        <div
                          className={`h-full rounded-md px-1 py-0.5 overflow-hidden transition-all relative ${
                            isSelected ? "ring-2 ring-indigo-400" : ""
                          }`}
                          style={{
                            backgroundColor: isDone
                              ? "rgba(34,197,94,0.15)"
                              : color
                              ? `${color}22`
                              : "rgba(209,213,219,0.4)",
                            borderLeft: `2px solid ${isDone ? "#16a34a" : (color ?? "#9ca3af")}`,
                          }}
                        >
                          {isDone && (
                            <span className="absolute top-0.5 right-0.5 text-green-600 text-[10px] leading-none">✓</span>
                          )}
                          {isTS ? (
                            <>
                              <p className="text-[10px] font-semibold text-gray-900 leading-tight truncate">
                                {EMOJI_MAP[type!] ?? ""}{" "}
                                {event.summary.replace(/^[^\w]+/, "").trim()}
                              </p>
                              <p className="text-[9px] leading-tight" style={{ color: isDone ? "#16a34a" : (color ?? undefined) }}>
                                {formatTime(event.start)}
                              </p>
                            </>
                          ) : (
                            <p className="text-[10px] text-gray-500 leading-tight truncate">
                              {event.summary}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Action sheet: selected TrainSync event ─────────────────────── */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="absolute bottom-20 left-4 right-4 bg-white border border-gray-300 rounded-2xl p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-xl">
                {EMOJI_MAP[parseType(selectedEvent.summary)] ?? "🏅"}
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {selectedEvent.summary.replace(/^[^\w]+/, "").trim()}
                </p>
                <p className="text-xs text-gray-500">
                  {formatTime(selectedEvent.start)} –{" "}
                  {formatTime(selectedEvent.end)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => openEdit(selectedEvent)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-800 text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Edit Time
              </button>
              <button
                onClick={() => {
                  setConfirmDelete(selectedEvent);
                  setSelectedEvent(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm sheet ───────────────────────────────────────── */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="absolute bottom-20 left-4 right-4 bg-white border border-gray-300 rounded-2xl p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-white mb-0.5">
              Delete this session?
            </p>
            <p className="text-xs text-gray-500 mb-4">
              {confirmDelete.summary.replace(/^[^\w]+/, "").trim()} ·{" "}
              {formatTime(confirmDelete.start)}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-gray-500 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.id)}
                disabled={!!deletingId}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-60 transition-colors"
              >
                {deletingId ? "…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit modal ────────────────────────────────────────────────── */}
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
