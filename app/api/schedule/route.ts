import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchBusySlots, fetchAllEventsByDay, fetchWeekEvents } from "@/lib/google-calendar";
import { buildWeeklyPlan, getWeekStart } from "@/lib/scheduler";
import { getCurrentPhase } from "@/lib/training-config";

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

    // Apply phase-specific session template when within the 17-week plan window
    const phaseCtx = getCurrentPhase(weekStart);
    const targetCount = phaseCtx?.phase.weeklyPlan.length ?? 5;

    // Fetch busy slots, day event preview, and existing TrainSync events in parallel
    const [busySlots, calendarEventsByDay, existingEvents] = await Promise.all([
      fetchBusySlots(session.accessToken, weekStart, weekEnd),
      fetchAllEventsByDay(session.accessToken, weekStart, weekEnd),
      fetchWeekEvents(session.accessToken, weekStart, weekEnd),
    ]);

    // If the week is already fully scheduled, skip generating new proposals
    if (existingEvents.length >= targetCount) {
      return NextResponse.json({
        proposals: [],
        warnings: [],
        weekStart: weekStart.toISOString(),
        calendarEventsByDay,
      });
    }

    const result = buildWeeklyPlan({
      busySlots,
      weekStart,
      weeklyPlan: phaseCtx?.phase.weeklyPlan,
    });

    return NextResponse.json({
      proposals: result.proposals,
      warnings: result.warnings,
      weekStart: weekStart.toISOString(),
      calendarEventsByDay,
    });
  } catch (error) {
    console.error("Schedule API error:", error);
    return NextResponse.json(
      { error: "Failed to build schedule" },
      { status: 500 }
    );
  }
}
