"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WorkoutCard from "@/components/WorkoutCard";
import WeekFocusCard from "@/components/WeekFocusCard";
import SyncStatusCard from "@/components/SyncStatusCard";
import TimePickerModal, { type WeekDay } from "@/components/TimePickerModal";
import BottomNav from "@/components/BottomNav";
import Image from "next/image";
import { formatDay, getWeekStart } from "@/lib/scheduler";
import { getCurrentPhase } from "@/lib/training-config";
import type {
  CalEventsByDay,
  EnrichedSession,
  Goal,
  PersonalBest,
  PhaseContext,
  WodifyParsed,
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
  Run:      { icon: "🏃", color: "text-rose-600",   bg: "bg-rose-50",   border: "border-rose-200"   },
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

function logTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadBadgeStyle(load: string): string {
  switch (load) {
    case "very_high": return "bg-red-100 text-red-700 border-red-200";
    case "high":      return "bg-orange-100 text-orange-700 border-orange-200";
    case "moderate":  return "bg-amber-100 text-amber-700 border-amber-200";
    default:          return "bg-green-100 text-green-700 border-green-200";
  }
}

function intensityColor(score: number): string {
  if (score >= 8) return "bg-red-500";
  if (score >= 6) return "bg-orange-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-green-500";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [weekOffset, setWeekOffset] = useState(0);
  const [proposals, setProposals] = useState<WorkoutProposal[]>([]);
  const [scheduledEvents, setScheduledEvents] = useState<ScheduledEvent[]>([]);
  const [completedEventIds, setCompletedEventIds] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [calEventsByDay, setCalEventsByDay] = useState<CalEventsByDay>({});
  const [pageState, setPageState] = useState<PageState>("loading");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [justScheduledCount, setJustScheduledCount] = useState(0);
  const [editingSession, setEditingSession] = useState<WorkoutSession | null>(null);
  const [unschedulingId, setUnschedulingId] = useState<string | null>(null);
  const [confirmUnschedule, setConfirmUnschedule] = useState<ScheduledEvent | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);

  // ─── Log session state ────────────────────────────────────────────────────
  const [logDate, setLogDate] = useState(logTodayISO);
  const [imageDataUrls, setImageDataUrls] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [wodParsed, setWodParsed] = useState<WodifyParsed | null>(null);
  const [wodEnriched, setWodEnriched] = useState<EnrichedSession | null>(null);
  const [logConfirmed, setLogConfirmed] = useState(false);
  const [logNotes, setLogNotes] = useState("");
  const [confirmingNotes, setConfirmingNotes] = useState(false);
  const [newPRs, setNewPRs] = useState<PersonalBest[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentWeekISO = useMemo(() => weekStartForOffset(weekOffset), [weekOffset]);

  const phaseContext: PhaseContext | null = useMemo(
    () => getCurrentPhase(new Date(currentWeekISO + "T12:00:00")),
    [currentWeekISO]
  );

  // The target for the viewed week (phase-specific or default)
  const weeklyTarget = phaseContext?.phase.weeklyPlan ?? DEFAULT_TARGET;

  // Build Mon–Sun day buttons for the date picker (past days disabled)
  const weekDays = useMemo((): WeekDay[] => {
    const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayISO = new Date().toISOString().split("T")[0];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(currentWeekISO + "T12:00:00");
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().split("T")[0];
      return {
        iso,
        label: DAY_LABELS[d.getDay()],
        date: d.getDate(),
        disabled: iso < todayISO,
      };
    });
  }, [currentWeekISO]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  const loadSchedule = useCallback(async (weekISO: string) => {
    setPageState("loading");
    setScheduleError(null);
    setProposals([]);
    setScheduledEvents([]);
    setCompletedEventIds(new Set());
    setJustScheduledCount(0);
    try {
      const res = await fetch(`/api/schedule?weekStart=${weekISO}`);
      if (!res.ok) throw new Error("Failed to load schedule");
      const data = await res.json();
      setProposals(data.proposals ?? []);
      setWarnings(data.warnings ?? []);
      setCalEventsByDay(data.calendarEventsByDay ?? {});
      setScheduledEvents(data.scheduledEvents ?? []);
      setCompletedEventIds(new Set(data.completedEventIds ?? []));
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

  // Fetch readiness and athlete profile once on mount
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/athlete")
      .then((r) => r.ok ? r.json() : null)
      .then((profile) => { if (profile?.goals) setGoals(profile.goals); })
      .catch(() => {});
  }, [status]);

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

  const handleTimeConfirm = (id: string, startTime: string, day?: string) => {
    const [h, m] = startTime.split(":").map(Number);
    const endHour = h + 1;
    const endTime = `${endHour.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    setProposals((prev) =>
      prev.map((p) => {
        if (p.session.id !== id) return p;
        const dayStr = day ?? p.session.day;
        return {
          ...p,
          status: "accepted",
          session: {
            ...p.session,
            day: dayStr,
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

  // ─── Log session handlers ─────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = "";

    setWodParsed(null);
    setWodEnriched(null);
    setParseError(null);
    setLogConfirmed(false);
    setLogNotes("");
    setNewPRs([]);

    let loaded = 0;
    const urls: string[] = new Array(files.length);
    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = () => {
        urls[idx] = reader.result as string;
        loaded++;
        if (loaded === files.length) setImageDataUrls(urls);
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleParse() {
    if (!imageDataUrls.length) return;
    setParsing(true);
    setParseError(null);
    try {
      const res = await fetch("/api/wodify/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: imageDataUrls, date: logDate }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Parse failed");
      }
      const data = await res.json();
      setWodParsed(data.parsed);
      setWodEnriched(data.enriched);
    } catch (err) {
      setParseError(String(err));
    } finally {
      setParsing(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (imageDataUrls.length && !wodParsed && !parsing) handleParse();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUrls]);

  async function handleConfirmLog() {
    setConfirmingNotes(true);
    try {
      if (logNotes.trim() && wodParsed) {
        const res = await fetch("/api/session/parse-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: logDate, notes: logNotes, wodContext: wodParsed }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.newPersonalBests?.length) setNewPRs(data.newPersonalBests);
        }
      }
    } catch {
      // non-fatal
    } finally {
      setConfirmingNotes(false);
      setLogConfirmed(true);
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
          goals={goals}
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

        {/* ── Completed Sessions ───────────────────────────────────────────── */}
        {scheduledEvents.filter((e) => completedEventIds.has(e.id)).length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-3">Completed</h2>
            <div className="space-y-2">
              {scheduledEvents
                .filter((e) => completedEventIds.has(e.id))
                .map((event) => {
                  const type = parseWorkoutType(event.summary) ?? "Crossfit";
                  const cfg = workoutConfig[type];
                  const dayStr = event.start.substring(0, 10);
                  return (
                    <div
                      key={event.id}
                      className="rounded-2xl border p-4 flex items-center gap-3 bg-green-50 border-green-200"
                    >
                      <span className="text-xl flex-shrink-0">{cfg.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-green-700 truncate">
                          {type}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDay(dayStr)} · {formatEventTime(event.start)}
                        </p>
                      </div>
                      <span className="text-green-600 text-lg flex-shrink-0">✓</span>
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* ── Scheduled Sessions ───────────────────────────────────────────── */}
        {scheduledEvents.filter((e) => !completedEventIds.has(e.id)).length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-3">Scheduled</h2>
            <div className="space-y-2">
              {scheduledEvents
                .filter((e) => !completedEventIds.has(e.id))
                .map((event) => {
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

        {/* ── Pending (To Schedule) ────────────────────────────────────────── */}
        {pageState === "loading" ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : proposals.length > 0 ? (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">Pending</h2>
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
              {proposals.map((proposal) => (
                <WorkoutCard
                  key={proposal.session.id}
                  proposal={proposal}
                  dayEvents={calEventsByDay[proposal.session.day] ?? []}
                  openGymSuggestion={proposal.session.openGymSuggestion ?? null}
                  onAccept={handleAccept}
                  onSkip={handleSkip}
                  onChangeTime={handleChangeTime}
                />
              ))}
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

        {/* ── Log Session ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Log Session</h2>

          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-4">
            {/* Date picker row */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Date</p>
              <input
                type="date"
                value={logDate}
                max={logTodayISO()}
                onChange={(e) => {
                  setLogDate(e.target.value);
                  setWodParsed(null);
                  setWodEnriched(null);
                  setParseError(null);
                  setLogConfirmed(false);
                  setImageDataUrls([]);
                  setLogNotes("");
                  setNewPRs([]);
                }}
                className="text-sm text-gray-600 border border-gray-200 rounded-lg px-2 py-1 bg-white"
              />
            </div>

            {/* Upload area */}
            {!logConfirmed && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <label
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-3 w-full rounded-2xl border-2 border-dashed p-6 cursor-pointer transition-colors ${
                    imageDataUrls.length
                      ? "border-indigo-300 bg-indigo-50"
                      : "border-gray-300 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50"
                  }`}
                >
                  <span className="text-3xl">📸</span>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">
                      {imageDataUrls.length
                        ? `${imageDataUrls.length} screenshot${imageDataUrls.length > 1 ? "s" : ""} selected — tap to change`
                        : "Upload Wodify screenshots"}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Select all screenshots for this session
                    </p>
                  </div>
                </label>

                {/* Thumbnails */}
                {imageDataUrls.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {imageDataUrls.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={url}
                        alt={`Screenshot ${i + 1}`}
                        className="h-20 w-auto rounded-xl border border-gray-200 flex-shrink-0 object-contain bg-white"
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Parsing spinner */}
            {parsing && (
              <div className="flex items-center gap-3 py-4 justify-center">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500">
                  {imageDataUrls.length > 1
                    ? `Combining ${imageDataUrls.length} screenshots…`
                    : "Parsing your WOD…"}
                </p>
              </div>
            )}

            {/* Parse error */}
            {parseError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-sm text-red-600">{parseError}</p>
                <button
                  onClick={handleParse}
                  className="mt-1.5 text-sm text-red-500 underline"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Parsed result */}
            {wodParsed && !logConfirmed && !parsing && (
              <div className="space-y-3">
                {/* Badges */}
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs font-medium bg-orange-100 text-orange-700 border border-orange-200 rounded-full px-2.5 py-1">
                    🏋️ {wodParsed.sessionType.replace(/_/g, " ")}
                  </span>
                  <span className={`text-xs font-medium border rounded-full px-2.5 py-1 ${loadBadgeStyle(wodParsed.overallLoad)}`}>
                    {wodParsed.overallLoad.replace("_", " ")} load
                  </span>
                  {wodParsed.box && (
                    <span className="text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-2.5 py-1">
                      📍 {wodParsed.box}
                    </span>
                  )}
                </div>

                {/* Sections */}
                {wodParsed.sections.length > 0 && (
                  <div className="space-y-2">
                    {wodParsed.sections.map((section, i) => (
                      <div key={i} className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                          {section.type} — {section.name}
                        </p>
                        <p className="text-xs text-gray-600 whitespace-pre-line leading-relaxed">
                          {section.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Movements */}
                {(() => {
                  const all = wodParsed.sections.flatMap((s) => s.movements);
                  const unique = all.filter((m, i) => all.indexOf(m) === i);
                  return unique.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {unique.map((m) => (
                        <span
                          key={m}
                          className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2.5 py-1"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}

                {/* Strava match status */}
                {wodEnriched?.performance ? (
                  <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-3">
                    <span className="text-lg">🏃</span>
                    <div className="text-xs text-green-700">
                      <p className="font-semibold">Strava matched</p>
                      <p>
                        {wodEnriched.performance.duration} min
                        {wodEnriched.performance.averageHR != null &&
                          ` · avg HR ${wodEnriched.performance.averageHR} bpm`}
                        {wodEnriched.performance.calories != null &&
                          ` · ${wodEnriched.performance.calories} kcal`}
                      </p>
                    </div>
                  </div>
                ) : wodEnriched?.pendingMatch ? (
                  <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <span className="text-lg">⏳</span>
                    <p className="text-xs text-amber-700">
                      Strava sync pending — will match automatically when your session syncs.
                    </p>
                  </div>
                ) : null}

                {/* Intensity bar */}
                {wodEnriched?.enrichedIntensity != null && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Intensity</p>
                      <span className="text-sm font-bold text-gray-900">{wodEnriched.enrichedIntensity}/10</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${intensityColor(wodEnriched.enrichedIntensity)}`}
                        style={{ width: `${wodEnriched.enrichedIntensity * 10}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Notes textarea */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Session notes (optional)
                  </p>
                  <textarea
                    value={logNotes}
                    onChange={(e) => setLogNotes(e.target.value)}
                    placeholder="e.g. weights you used, how it felt, any notes"
                    rows={3}
                    className="w-full text-sm text-gray-900 rounded-xl border border-gray-200 px-3 py-2.5 bg-gray-50 placeholder-gray-400 resize-none focus:outline-none focus:border-indigo-300"
                  />
                </div>

                <button
                  onClick={handleConfirmLog}
                  disabled={confirmingNotes}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {confirmingNotes ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Saving…
                    </>
                  ) : "Looks good ✓"}
                </button>
              </div>
            )}

            {/* Success */}
            {logConfirmed && (
              <div className="space-y-3">
                {newPRs.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-amber-800 font-semibold text-sm mb-1">
                      🏆 New Personal Best{newPRs.length > 1 ? "s" : ""}!
                    </p>
                    {newPRs.map((pr) => (
                      <p key={pr.lift} className="text-amber-700 text-sm">
                        {pr.lift.replace(/([A-Z])/g, " $1").trim()}: estimated 1RM —{" "}
                        <span className="font-semibold">
                          {Math.round(pr.weight * (1 + pr.reps / 30) * 10) / 10}kg
                        </span>
                      </p>
                    ))}
                  </div>
                )}
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <p className="text-2xl mb-2">✅</p>
                  <p className="text-green-700 font-semibold text-sm">Session logged!</p>
                  <p className="text-green-600/70 text-xs mt-0.5">
                    {wodParsed?.box ? `${wodParsed.box} WOD saved` : "WOD saved"} for {logDate}.
                  </p>
                  <button
                    onClick={() => {
                      setImageDataUrls([]);
                      setWodParsed(null);
                      setWodEnriched(null);
                      setLogConfirmed(false);
                      setLogNotes("");
                      setNewPRs([]);
                      setLogDate(logTodayISO());
                    }}
                    className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Log another session
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="h-4" />
      </main>

      {/* ── Time picker modal ────────────────────────────────────────────────── */}
      {editingSession && (
        <TimePickerModal
          session={editingSession}
          onConfirm={handleTimeConfirm}
          onClose={() => setEditingSession(null)}
          showDayPicker
          weekDays={weekDays}
          calEventsByDay={calEventsByDay}
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
