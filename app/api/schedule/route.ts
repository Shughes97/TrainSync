import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchBusySlots, fetchAllEventsByDay, fetchWeekEvents } from "@/lib/google-calendar";
import { buildWeeklyPlan, getWeekStart } from "@/lib/scheduler";
import { getCurrentPhase, getOpenGymSuggestion } from "@/lib/training-config";
import { getActivities } from "@/lib/kv";
import type { OpenGymSuggestion, WorkoutType } from "@/types";

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

/**
 * Build an OpenGymSuggestion enriched with context from recent Strava activity data.
 * The base suggestion comes from the phase plan; the note is personalised using
 * how many days ago the user last did a weight-training session and their effort score.
 */
function buildStrengthSuggestion(
  phaseFocus: string,
  strengthSessionIndex: number,
  recentStrengthActivities: Array<{
    name: string;
    start_date: string;
    suffer_score: number | null;
    moving_time: number;
  }>
): OpenGymSuggestion | null {
  const base = getOpenGymSuggestion(phaseFocus, strengthSessionIndex);
  if (!base) return null;

  if (recentStrengthActivities.length === 0) return base;

  const last = recentStrengthActivities[0];
  const daysAgo = Math.floor(
    (Date.now() - new Date(last.start_date).getTime()) / (1000 * 60 * 60 * 24)
  );
  const durationMins = Math.round(last.moving_time / 60);
  const suffer = last.suffer_score;

  let stravaNote = "";

  if (daysAgo <= 2) {
    stravaNote = `Your last strength session ("${last.name}") was ${daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : "2 days ago"}${suffer ? ` — effort score ${suffer}` : ""}. Keep intensity moderate to avoid overreaching.`;
  } else if (daysAgo <= 5) {
    stravaNote = `Last strength session: "${last.name}" ${daysAgo} days ago (${durationMins} min${suffer ? `, effort ${suffer}` : ""}). Good recovery window — push hard today.`;
  } else {
    stravaNote = `It's been ${daysAgo} days since your last strength session ("${last.name}"). Start conservatively and build into the session.`;
  }

  return { ...base, note: `${base.note} ${stravaNote}` };
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

    // Fetch calendar data and Strava activities in parallel
    const [busySlots, calendarEventsByDay, existingEvents, stravaActivities] =
      await Promise.all([
        fetchBusySlots(session.accessToken, weekStart, weekEnd),
        fetchAllEventsByDay(session.accessToken, weekStart, weekEnd),
        fetchWeekEvents(session.accessToken, weekStart, weekEnd),
        getActivities(),
      ]);

    // Recent weight training activities from Strava, newest first
    const recentStrength = stravaActivities
      .filter((a) => a.type === "WeightTraining" || a.type === "Crossfit")
      .sort(
        (a, b) =>
          new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
      );

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

    const scheduledDays = existingEvents.map((e) => e.start.substring(0, 10));

    const result = buildWeeklyPlan({
      busySlots,
      weekStart,
      weeklyPlan: remainingPlan,
      scheduledDays,
    });

    // Attach Strava-enriched strength suggestions to each Strength proposal
    const phaseFocus = phaseCtx?.phase.focus ?? "endurance_base";
    let strengthIdx = 0;

    const enrichedProposals = result.proposals.map((proposal) => {
      if (proposal.session.type !== "Strength") return proposal;

      const suggestion = buildStrengthSuggestion(
        phaseFocus,
        strengthIdx++,
        recentStrength
      );

      if (!suggestion) return proposal;

      return {
        ...proposal,
        session: { ...proposal.session, openGymSuggestion: suggestion },
      };
    });

    return NextResponse.json({
      proposals: enrichedProposals,
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
