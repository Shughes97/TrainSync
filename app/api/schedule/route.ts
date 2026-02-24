import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchBusySlots, fetchAllEventsByDay, fetchWeekEvents } from "@/lib/google-calendar";
import { buildWeeklyPlan, getWeekStart } from "@/lib/scheduler";
import { getCurrentPhase } from "@/lib/training-config";
import { getActivities, getRecentEnrichedSessions } from "@/lib/kv";
import { getOrGeneratePrescription } from "@/lib/strengthPrescriber";
import type { WorkoutType } from "@/types";

// Default fallback plan when outside the 17-week training window
const DEFAULT_WEEKLY_PLAN: Array<{ type: WorkoutType; isHard: boolean }> = [
  { type: "Crossfit", isHard: true },
  { type: "Crossfit", isHard: true },
  { type: "Strength", isHard: false },
  { type: "Run", isHard: false },
  { type: "Bike", isHard: false },
];

function parseWorkoutType(summary: string): WorkoutType | null {
  if (summary.includes("CrossFit")) return "Crossfit";
  if (summary.includes("Strength")) return "Strength";
  if (summary.includes("Run")) return "Run";
  if (summary.includes("Bike")) return "Bike";
  return null;
}

function parseEventCategory(summary: string): string | null {
  if (summary.includes("CrossFit")) return "gym";
  if (summary.includes("Strength")) return "gym";
  if (summary.includes("Run")) return "run";
  if (summary.includes("Bike")) return "bike";
  return null;
}

function stravaActivityCategory(stravaType: string): string | null {
  if (stravaType === "WeightTraining" || stravaType === "Crossfit") return "gym";
  if (stravaType === "Run" || stravaType === "VirtualRun") return "run";
  if (stravaType === "Ride" || stravaType === "VirtualRide") return "bike";
  return null;
}


export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const weekStartParam = req.nextUrl.searchParams.get("weekStart");
    const weekStart = weekStartParam
      ? getWeekStart(new Date(weekStartParam))
      : getWeekStart();

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const phaseCtx = getCurrentPhase(weekStart);
    const weeklyPlan = phaseCtx?.phase.weeklyPlan ?? DEFAULT_WEEKLY_PLAN;

    // Fetch calendar data, Strava activities, and recent enriched sessions in parallel
    const [busySlots, calendarEventsByDay, existingEvents, stravaActivities, recentEnriched] =
      await Promise.all([
        fetchBusySlots(session.accessToken, weekStart, weekEnd),
        fetchAllEventsByDay(session.accessToken, weekStart, weekEnd),
        fetchWeekEvents(session.accessToken, weekStart, weekEnd),
        getActivities(),
        getRecentEnrichedSessions(14),
      ]);

    // Recent weight training activities from Strava, newest first
    const recentStrength = stravaActivities
      .filter((a) => a.type === "WeightTraining" || a.type === "Crossfit")
      .sort(
        (a, b) =>
          new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
      );

    // Determine which scheduled events are already completed via Strava
    const completedEventIds: string[] = [];
    for (const event of existingEvents) {
      const dayStr = event.start.substring(0, 10);
      const eventCat = parseEventCategory(event.summary);
      if (!eventCat) continue;
      const matched = stravaActivities.some(
        (a) =>
          a.start_date.substring(0, 10) === dayStr &&
          stravaActivityCategory(a.type) === eventCat
      );
      if (matched) completedEventIds.push(event.id);
    }

    // Determine which session types are already scheduled this week
    const scheduledTypes = existingEvents
      .map((e) => parseWorkoutType(e.summary))
      .filter(Boolean) as WorkoutType[];

    // Build the remaining plan by removing already-scheduled types
    const remainingPlan = [...weeklyPlan];
    for (const type of scheduledTypes) {
      const idx = remainingPlan.findIndex((p) => p.type === type);
      if (idx !== -1) remainingPlan.splice(idx, 1);
    }

    // If all sessions are covered, return no proposals
    if (remainingPlan.length === 0) {
      return NextResponse.json({
        proposals: [],
        warnings: [],
        weekStart: weekStart.toISOString(),
        calendarEventsByDay,
        scheduledEvents: existingEvents,
        completedEventIds,
      });
    }

    const scheduledDays = existingEvents.map((e) => e.start.substring(0, 10));

    const result = buildWeeklyPlan({
      busySlots,
      weekStart,
      weeklyPlan: remainingPlan,
      scheduledDays,
    });

    // Build week date array for context passed to Claude
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    });

    // Attach Claude-generated strength prescriptions to each Strength proposal
    const phaseFocus = phaseCtx?.phase.focus ?? "endurance_base";
    let strengthIdx = 0;

    const enrichedProposals = await Promise.all(
      result.proposals.map(async (proposal) => {
        if (proposal.session.type !== "Strength") return proposal;

        const suggestion = await getOrGeneratePrescription(
          proposal.session.day,
          phaseFocus,
          strengthIdx++,
          recentEnriched,
          recentStrength,
          weekDates,
        );

        return {
          ...proposal,
          session: { ...proposal.session, openGymSuggestion: suggestion },
        };
      })
    );

    return NextResponse.json({
      proposals: enrichedProposals,
      warnings: result.warnings,
      weekStart: weekStart.toISOString(),
      calendarEventsByDay,
      scheduledEvents: existingEvents,
      completedEventIds,
    });
  } catch (error) {
    console.error("Schedule API error:", error);
    return NextResponse.json(
      { error: "Failed to build schedule" },
      { status: 500 }
    );
  }
}
