"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import WorkoutCard from "@/components/WorkoutCard";
import WeekFocusCard from "@/components/WeekFocusCard";
import SyncStatusCard from "@/components/SyncStatusCard";
import TimePickerModal from "@/components/TimePickerModal";
import BottomNav from "@/components/BottomNav";
import Image from "next/image";
import { formatDay, getWeekStart } from "@/lib/scheduler";
import {
  getCurrentPhase,
  daysUntilGoal,
  getOpenGymSuggestion,
} from "@/lib/training-config";
import type {
  CalEventsByDay,
  PhaseContext,
  WorkoutProposal,
  WorkoutSession,
  WorkoutType,
} from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduledEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
}

type PageState = "loading" | "ready" | "scheduling" | "error";

// ─── Constants ────────────────────────────────────────────────────────────────

const workoutConfig: Record<
  WorkoutType,
  { icon: string; color: string; bg: string; border: string }
> = {
  Crossfit: { icon: "🏋️", color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
  Strength: { icon: "💪", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
  Run:      { icon: "🏃", color: "text-green-600",  bg: "bg-green-50",  border: "border-green-200"  },
  Bike:     { icon: "🚴", color: "text-blue-600",   bg: "bg-blue-50",   border: "border-blue-200"   },
};

// Fallback weekly target when outside the 17-week training window
const DEFAULT_TARGET: Array<{ type: WorkoutType; isHard: boolean }> = [
  { type: "Crossfit", isHard: true },
  { type: "Crossfit", isHard: true },
  { type: "Strength", isHard: false },
  { type: "Run",      isHard: false },
  { type: "Bike",     isHard: false },
];

// Google Calendar event title lookup (mirrors google-calendar.ts)
const EVENT_TITLES: Record<WorkoutType, string> = {
  Crossfit: "🏋️ CrossFit Session",
  Strength: "💪 Strength Training",
  Run:      "🏃 Run",
  Bike:     "🚴 Bike Ride",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function weekStartForOffset(offset: number): string {
  const base = getWeekStart();
  base.setDate(base.getDate() + offset * 7);
  return base.toISOString().split("T")[0];
}

function weekLabel(mondayISO: string): string {
  const monday = new Date(mondayISO + "T12:00:00");
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function parseWorkoutType(summary: string): WorkoutType | null {
  if (summary.includes("CrossFit")) return "Crossfit";
  if (summary.includes("Strength")) return "Strength";
  if (summary.includes("Run")) return "Run";
  if (summary.includes("Bike")) return "Bike";
  return null;
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [weekOffset, setWeekOffset] = useState(0);
  const [proposals, setProposals] = useState<WorkoutProposal[]>([]);
  const [scheduledEvents, setScheduledEvents] = useState<ScheduledEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [calEventsByDay, setCalEventsByDay] = useState<CalEventsByDay>({});
  const [pageState, setPageState] = useState<PageState>("loading");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [justScheduledCount, setJustScheduledCount] = useState(0);
  const [editingSession, setEditingSession] = useState<WorkoutSession | null>(null);
  const [unschedulingId, setUnschedulingId] = useState<string | null>(null);
  const [confirmUnschedule, setConfirmUnschedule] = useState<ScheduledEvent | null>(null);

  const currentWeekISO = useMemo(() => weekStartForOffset(weekOffset), [weekOffset]);

  const phaseContext: PhaseContext | null = useMemo(
    () => getCurrentPhase(new Date(currentWeekISO + "T12:00:00")),
    [currentWeekISO]
  );

  const daysUntilCentury = useMemo(() => daysUntilGoal("2026-05-08"), []);
  const daysUntilHoliday = useMemo(() => daysUntilGoal("2026-06-15"), []);

  // The target for the viewed week (phase-specific or default)
  const weeklyTarget = phaseContext?.phase.weeklyPlan ?? DEFAULT_TARGET;

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  const loadSchedule = useCallback(async (weekISO: string) => {
    setPageState("loading");
    setScheduleError(null);
    setProposals([]);
    setScheduledEvents([]);
    setJustScheduledCount(0);
    try {
      const res = await fetch(`/api/schedule?weekStart=${weekISO}`);
      if (!res.ok) throw new Error("Failed to load schedule");
      const data = await res.json();
      setProposals(data.proposals ?? []);
      setWarnings(data.warnings ?? []);
      setCalEventsByDay(data.calendarEventsByDay ?? {});
      setScheduledEvents(data.scheduledEvents ?? []);
      setPageState("ready");
    } catch (err) {
      console.error(err);
      setPageState("error");
      setScheduleError("Could not load your schedule. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") loadSchedule(currentWeekISO);
  }, [status, currentWeekISO, loadSchedule]);

  // ─── Proposal actions ────────────────────────────────────────────────────────

  const handleAccept = (id: string) => {
    setProposals((prev) =>
      prev.map((p) => (p.session.id === id ? { ...p, status: "accepted" } : p))
    );
  };

  const handleSkip = (id: string) => {
    setProposals((prev) =>
      prev.map((p) => (p.session.id === id ? { ...p, status: "skipped" } : p))
    );
  };

  const handleChangeTime = (id: string) => {
    const proposal = proposals.find((p) => p.session.id === id);
    if (proposal) setEditingSession(proposal.session);
  };

  const handleTimeConfirm = (id: string, startTime: string) => {
    const [h, m] = startTime.split(":").map(Number);
    const endHour = h + 1;
    const endTime = `${endHour.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    setProposals((prev) =>
      prev.map((p) => {
        if (p.session.id !== id) return p;
        const dayStr = p.session.day;
        return {
          ...p,
          status: "accepted",
          session: {
            ...p.session,
            startTime,
            endTime,
            startISO: `${dayStr}T${startTime}:00`,
            endISO: `${dayStr}T${endTime}:00`,
            window: h < 12 ? "morning" : "evening",
          },
        };
      })
    );
    setEditingSession(null);
  };

  const handleAcceptAll = () => {
    setProposals((prev) =>
      prev.map((p) => (p.status === "pending" ? { ...p, status: "accepted" } : p))
    );
  };

  // ─── Schedule to calendar ────────────────────────────────────────────────────

  const handleScheduleWeek = async () => {
    const toCreate = proposals.filter((p) => p.status === "accepted");
    if (toCreate.length === 0) return;

    setPageState("scheduling");
    setScheduleError(null);

    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: toCreate.map((p) => p.session) }),
      });
      if (!res.ok) throw new Error("Failed to create events");
      const data = await res.json();
      const created: Array<{ id: string; eventId: string }> = data.created ?? [];

      // Optimistically move accepted proposals into the scheduled section
      const newScheduled: ScheduledEvent[] = toCreate.map((p) => ({
        id: created.find((c) => c.id === p.session.id)?.eventId ?? p.session.id,
        summary: EVENT_TITLES[p.session.type],
        start: p.session.startISO,
        end: p.session.endISO,
      }));

      setScheduledEvents((prev) => [...prev, ...newScheduled]);
      setProposals((prev) => prev.filter((p) => p.status !== "accepted"));
      setJustScheduledCount(toCreate.length);
      setPageState("ready");
    } catch (err) {
      console.error(err);
      setScheduleError("Failed to create calendar events. Please try again.");
      setPageState("ready");
    }
  };

  // ─── Unschedule ──────────────────────────────────────────────────────────────

  async function handleUnschedule(event: ScheduledEvent) {
    setUnschedulingId(event.id);
    setConfirmUnschedule(null);
    try {
      const res = await fetch(`/api/calendar/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      // Reload so proposals update to include the newly freed session type
      await loadSchedule(currentWeekISO);
    } catch {
      setScheduleError("Failed to unschedule session.");
      setPageState("ready");
    } finally {
      setUnschedulingId(null);
    }
  }

  // ─── Derived values ──────────────────────────────────────────────────────────

  const acceptedCount = proposals.filter((p) => p.status === "accepted").length;
  const pendingCount = proposals.filter((p) => p.status === "pending").length;
  const isCurrentWeek = weekOffset === 0;

  const scheduledByType = scheduledEvents.reduce<Record<string, number>>((acc, e) => {
    const type = parseWorkoutType(e.summary);
    if (type) acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});

  const isInitialLoading =
    status === "loading" ||
    (pageState === "loading" && scheduledEvents.length === 0 && proposals.length === 0);

  if (isInitialLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Scanning your calendar…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-gray-50/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <span className="font-bold text-gray-900 text-lg">TrainSync</span>
          </div>
          <div className="flex items-center gap-3">
            {session?.user?.image && (
              <Image
                src={session.user.image}
                alt="avatar"
                width={28}
                height={28}
                className="rounded-full"
              />
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Week navigation */}
        <div className="max-w-lg mx-auto px-4 pb-3 flex items-center justify-between gap-2">
          <button
            onClick={() => setWeekOffset((o) => o - 1)}
            className="p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            aria-label="Previous week"
          >
            ←
          </button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-gray-900">
              {weekLabel(currentWeekISO)}
            </span>
            {!isCurrentWeek ? (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-xs text-indigo-600 hover:text-indigo-700 transition-colors mt-0.5"
              >
                Back to this week
              </button>
            ) : (
              <span className="text-xs text-gray-500 mt-0.5">This week</span>
            )}
          </div>
          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            className="p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            aria-label="Next week"
          >
            →
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Phase context */}
        <WeekFocusCard
          phaseContext={phaseContext}
          proposals={proposals}
          daysUntilCentury={daysUntilCentury}
          daysUntilHoliday={daysUntilHoliday}
        />

        {/* Strava / calendar sync health */}
        <SyncStatusCard />

        {/* Success banner */}
        {justScheduledCount > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-green-600 text-xl">✓</span>
            <div>
              <p className="text-green-700 font-medium text-sm">Scheduled!</p>
              <p className="text-green-600/70 text-sm mt-0.5">
                {justScheduledCount} session{justScheduledCount !== 1 ? "s" : ""} added to your
                Google Calendar.
              </p>
            </div>
          </div>
        )}

        {/* Error banner */}
        {(pageState === "error" || scheduleError) && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-red-600 text-sm">
              {scheduleError ?? "Something went wrong."}
            </p>
            <button
              onClick={() => loadSchedule(currentWeekISO)}
              className="mt-2 text-sm text-red-500 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1">
            {warnings.map((w, i) => (
              <p key={i} className="text-amber-700 text-sm">
                ⚠ {w}
              </p>
            ))}
          </div>
        )}

        {/* ── Weekly Target Progress ───────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Weekly Target</h2>
            <span
              className={`text-xs font-medium ${
                scheduledEvents.length >= weeklyTarget.length
                  ? "text-green-600"
                  : "text-gray-500"
              }`}
            >
              {scheduledEvents.length}/{weeklyTarget.length} scheduled
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {weeklyTarget.map((item, idx) => {
              const cfg = workoutConfig[item.type];
              const sameTypeBefore = weeklyTarget
                .slice(0, idx)
                .filter((t) => t.type === item.type).length;
              const isScheduled = sameTypeBefore < (scheduledByType[item.type] ?? 0);
              return (
                <div
                  key={idx}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    isScheduled
                      ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                      : "bg-gray-50 border-gray-200 text-gray-400"
                  }`}
                >
                  <span>{cfg.icon}</span>
                  <span>{item.type}</span>
                  {isScheduled && <span className="opacity-70">✓</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Scheduled Sessions ───────────────────────────────────────────── */}
        {scheduledEvents.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-3">Scheduled</h2>
            <div className="space-y-2">
              {scheduledEvents.map((event) => {
                const type = parseWorkoutType(event.summary) ?? "Crossfit";
                const cfg = workoutConfig[type];
                const dayStr = event.start.substring(0, 10);
                const isUnscheduling = unschedulingId === event.id;
                return (
                  <div
                    key={event.id}
                    className={`rounded-2xl border p-4 flex items-center justify-between gap-3 ${cfg.bg} ${cfg.border}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xl flex-shrink-0">{cfg.icon}</span>
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${cfg.color} truncate`}>
                          {type}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDay(dayStr)} · {formatEventTime(event.start)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setConfirmUnschedule(event)}
                      disabled={isUnscheduling}
                      className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {isUnscheduling ? "…" : "Unschedule"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── To Schedule ──────────────────────────────────────────────────── */}
        {pageState === "loading" ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : proposals.length > 0 ? (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">To Schedule</h2>
              {pendingCount > 0 && (
                <button
                  onClick={handleAcceptAll}
                  className="text-xs text-indigo-600 hover:text-indigo-700 transition-colors font-medium"
                >
                  Accept all
                </button>
              )}
            </div>
            <div className="space-y-3">
              {(() => {
                let strengthCount = 0;
                return proposals.map((proposal) => {
                  const suggestion =
                    proposal.session.type === "Strength" && phaseContext
                      ? getOpenGymSuggestion(
                          phaseContext.phase.focus,
                          strengthCount++
                        )
                      : null;
                  return (
                    <WorkoutCard
                      key={proposal.session.id}
                      proposal={proposal}
                      dayEvents={calEventsByDay[proposal.session.day] ?? []}
                      openGymSuggestion={suggestion}
                      onAccept={handleAccept}
                      onSkip={handleSkip}
                      onChangeTime={handleChangeTime}
                    />
                  );
                });
              })()}
            </div>
          </section>
        ) : scheduledEvents.length >= weeklyTarget.length ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
            <p className="text-green-700 font-semibold text-sm">Week fully scheduled!</p>
            <p className="text-green-600/70 text-xs mt-1">
              All {weeklyTarget.length} sessions are on your calendar.
            </p>
          </div>
        ) : scheduledEvents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm font-medium">No sessions found</p>
            <p className="text-gray-400 text-xs mt-1">
              No free slots in the 6:30–8am or 5–8pm windows this week.
            </p>
          </div>
        ) : null}

        {/* ── Schedule CTA ─────────────────────────────────────────────────── */}
        {acceptedCount > 0 && (
          <div className="sticky bottom-4">
            <button
              onClick={handleScheduleWeek}
              disabled={pageState === "scheduling"}
              className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-base transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              {pageState === "scheduling" ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Adding to Calendar…
                </>
              ) : (
                <>📅 Schedule {acceptedCount} Session{acceptedCount !== 1 ? "s" : ""}</>
              )}
            </button>
          </div>
        )}

        <div className="h-4" />
      </main>

      {/* ── Time picker modal ────────────────────────────────────────────────── */}
      {editingSession && (
        <TimePickerModal
          session={editingSession}
          onConfirm={handleTimeConfirm}
          onClose={() => setEditingSession(null)}
        />
      )}

      {/* ── Unschedule confirm sheet ─────────────────────────────────────────── */}
      {confirmUnschedule && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setConfirmUnschedule(null)}
        >
          <div
            className="absolute bottom-20 left-4 right-4 bg-white border border-gray-200 rounded-2xl p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-900 mb-1">
              Unschedule this session?
            </p>
            <p className="text-xs text-gray-600 mb-1">
              {confirmUnschedule.summary.replace(/^[^\w]+/, "").trim()} ·{" "}
              {formatEventTime(confirmUnschedule.start)}
            </p>
            <p className="text-xs text-gray-400 mb-4">
              This removes the event from Google Calendar. You can reschedule it anytime.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmUnschedule(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUnschedule(confirmUnschedule)}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-500 transition-colors"
              >
                Unschedule
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
