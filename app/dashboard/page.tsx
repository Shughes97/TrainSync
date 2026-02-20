"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import WorkoutCard from "@/components/WorkoutCard";
import WeeklyOverview from "@/components/WeeklyOverview";
import WeekFocusCard from "@/components/WeekFocusCard";
import SyncStatusCard from "@/components/SyncStatusCard";
import TimePickerModal from "@/components/TimePickerModal";
import Image from "next/image";
import Link from "next/link";
import { getWeekStart } from "@/lib/scheduler";
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
} from "@/types";

type PageState = "loading" | "ready" | "scheduling" | "done" | "error";

/** Returns the Monday ISO string for a given offset from the current week */
function weekStartForOffset(offset: number): string {
  const base = getWeekStart();
  base.setDate(base.getDate() + offset * 7);
  return base.toISOString().split("T")[0];
}

/** Format a Monday date for the week label, e.g. "17 Feb – 23 Feb" */
function weekLabel(mondayISO: string): string {
  const monday = new Date(mondayISO + "T12:00:00");
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return `${fmt(monday)} – ${fmt(sunday)}`;
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [weekOffset, setWeekOffset] = useState(0);
  const [proposals, setProposals] = useState<WorkoutProposal[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [calEventsByDay, setCalEventsByDay] = useState<CalEventsByDay>({});
  const [pageState, setPageState] = useState<PageState>("loading");
  const [scheduledCount, setScheduledCount] = useState(0);
  const [createdCount, setCreatedCount] = useState(0);
  const [editingSession, setEditingSession] = useState<WorkoutSession | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const currentWeekISO = useMemo(() => weekStartForOffset(weekOffset), [weekOffset]);

  // Phase context changes with the viewed week
  const phaseContext: PhaseContext | null = useMemo(
    () => getCurrentPhase(new Date(currentWeekISO + "T12:00:00")),
    [currentWeekISO]
  );

  // Goal countdowns are always relative to today
  const daysUntilCentury = useMemo(() => daysUntilGoal("2026-05-08"), []);
  const daysUntilHoliday = useMemo(() => daysUntilGoal("2026-06-15"), []);

  // Redirect unauthenticated users
  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  // Fetch schedule proposal whenever week changes
  const loadSchedule = useCallback(async (weekISO: string) => {
    setPageState("loading");
    setScheduleError(null);
    setProposals([]);
    try {
      const qs = `weekStart=${weekISO}`;
      const [schedRes, calRes] = await Promise.all([
        fetch(`/api/schedule?${qs}`),
        fetch(`/api/calendar?${qs}`),
      ]);

      if (!schedRes.ok) throw new Error("Failed to load schedule");

      const schedData = await schedRes.json();
      setProposals(schedData.proposals ?? []);
      setWarnings(schedData.warnings ?? []);
      setCalEventsByDay(schedData.calendarEventsByDay ?? {});

      if (calRes.ok) {
        const calData = await calRes.json();
        setScheduledCount((calData.events ?? []).length);
      }

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

  // Week navigation
  const goToPrevWeek = () => setWeekOffset((o) => o - 1);
  const goToNextWeek = () => setWeekOffset((o) => o + 1);
  const goToThisWeek = () => setWeekOffset(0);

  // Card actions
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
      setCreatedCount(data.created?.length ?? 0);

      setProposals((prev) =>
        prev.map((p) =>
          p.status === "accepted"
            ? {
                ...p,
                calendarEventId:
                  data.created?.find(
                    (c: { id: string; eventId: string }) => c.id === p.session.id
                  )?.eventId ?? "",
              }
            : p
        )
      );

      setPageState("done");
    } catch (err) {
      console.error(err);
      setScheduleError("Failed to create calendar events. Please try again.");
      setPageState("ready");
    }
  };

  const acceptedCount = proposals.filter((p) => p.status === "accepted").length;
  const pendingCount = proposals.filter((p) => p.status === "pending").length;
  const isCurrentWeek = weekOffset === 0;

  if (status === "loading" || (pageState === "loading" && proposals.length === 0)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-zinc-950">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-400 text-sm">Scanning your calendar…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur border-b border-zinc-800/60">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <span className="font-bold text-white text-lg">TrainSync</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/goals"
              className="text-xs text-zinc-500 hover:text-white transition-colors"
            >
              Plan
            </Link>
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
              className="text-xs text-zinc-500 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Week navigation bar */}
        <div className="max-w-lg mx-auto px-4 pb-3 flex items-center justify-between gap-2">
          <button
            onClick={goToPrevWeek}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Previous week"
          >
            ←
          </button>

          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-white">
              {weekLabel(currentWeekISO)}
            </span>
            {!isCurrentWeek && (
              <button
                onClick={goToThisWeek}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors mt-0.5"
              >
                Back to this week
              </button>
            )}
            {isCurrentWeek && (
              <span className="text-xs text-zinc-500 mt-0.5">This week</span>
            )}
          </div>

          <button
            onClick={goToNextWeek}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Next week"
          >
            →
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* This Week's Focus — phase summary widget */}
        <WeekFocusCard
          phaseContext={phaseContext}
          proposals={proposals}
          daysUntilCentury={daysUntilCentury}
          daysUntilHoliday={daysUntilHoliday}
        />

        {/* Sync status — shows Strava + calendar sync health, training load */}
        <SyncStatusCard />

        {/* Success banner */}
        {pageState === "done" && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-green-400 text-xl">✓</span>
            <div>
              <p className="text-green-400 font-medium text-sm">Week scheduled!</p>
              <p className="text-green-300/70 text-sm mt-0.5">
                {createdCount} session{createdCount !== 1 ? "s" : ""} added to your
                Google Calendar.
              </p>
            </div>
          </div>
        )}

        {/* Error banner */}
        {(pageState === "error" || scheduleError) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
            <p className="text-red-400 text-sm">
              {scheduleError ?? "Something went wrong."}
            </p>
            <button
              onClick={() => loadSchedule(currentWeekISO)}
              className="mt-2 text-sm text-red-300 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 space-y-1">
            {warnings.map((w, i) => (
              <p key={i} className="text-yellow-300 text-sm">
                ⚠ {w}
              </p>
            ))}
          </div>
        )}

        {/* Weekly overview */}
        <WeeklyOverview
          proposals={proposals}
          scheduledEventCount={scheduledCount}
        />

        {/* Proposals header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">
            {isCurrentWeek ? "This Week's Plan" : "Proposed Plan"}
          </h2>
          {pendingCount > 0 && pageState !== "done" && (
            <button
              onClick={handleAcceptAll}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              Accept all
            </button>
          )}
        </div>

        {/* Workout cards */}
        {pageState === "loading" ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : proposals.length === 0 ? (
          <div className="text-center py-16">
            {scheduledCount > 0 ? (
              <>
                <p className="text-zinc-400 text-sm font-medium">Week fully scheduled</p>
                <p className="text-zinc-600 text-xs mt-1">
                  You already have {scheduledCount} session{scheduledCount !== 1 ? "s" : ""} on your calendar this week.
                </p>
              </>
            ) : (
              <>
                <p className="text-zinc-500 text-sm">No free slots found this week.</p>
                <p className="text-zinc-600 text-xs mt-1">
                  Your calendar looks fully booked in the 6:30–8am and 5–8pm windows.
                </p>
              </>
            )}
          </div>
        ) : (
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
        )}

        {/* Schedule Week CTA */}
        {acceptedCount > 0 && pageState !== "done" && (
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
                <>
                  📅 Schedule {acceptedCount} Session
                  {acceptedCount !== 1 ? "s" : ""}
                </>
              )}
            </button>
          </div>
        )}

        {/* Refresh link */}
        {pageState === "done" && (
          <button
            onClick={() => loadSchedule(currentWeekISO)}
            className="w-full py-3 rounded-2xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 text-sm font-medium transition-colors"
          >
            Refresh Proposals
          </button>
        )}

        <div className="h-4" />
      </main>

      {/* Time picker modal */}
      {editingSession && (
        <TimePickerModal
          session={editingSession}
          onConfirm={handleTimeConfirm}
          onClose={() => setEditingSession(null)}
        />
      )}
    </div>
  );
}
