import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchBusySlots, fetchAllEventsByDay, fetchWeekEvents } from "@/lib/google-calendar";
import { buildWeeklyPlan, getWeekStart } from "@/lib/scheduler";
import { getCurrentPhase } from "@/lib/training-config";
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

    // Fetch busy slots, day event preview, and existing TrainSync events in parallel
    const [busySlots, calendarEventsByDay, existingEvents] = await Promise.all([
      fetchBusySlots(session.accessToken, weekStart, weekEnd),
      fetchAllEventsByDay(session.accessToken, weekStart, weekEnd),
      fetchWeekEvents(session.accessToken, weekStart, weekEnd),
    ]);

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
      });
    }

    const result = buildWeeklyPlan({
      busySlots,
      weekStart,
      weeklyPlan: remainingPlan,
    });

    return NextResponse.json({
      proposals: result.proposals,
      warnings: result.warnings,
      weekStart: weekStart.toISOString(),
      calendarEventsByDay,
      scheduledEvents: existingEvents,
    });
  } catch (error) {
    console.error("Schedule API error:", error);
    return NextResponse.json(
      { error: "Failed to build schedule" },
      { status: 500 }
    );
  }
}
