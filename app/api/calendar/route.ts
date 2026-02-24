import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createCalendarEvent, fetchWeekEvents, fetchAllEventsByDay } from "@/lib/google-calendar";
import { getWeekStart } from "@/lib/scheduler";
import { kv, storeGoogleTokens } from "@/lib/kv";
import type { StoredSession, StoredWeekSchedule } from "@/lib/kv";
import type { WorkoutSession } from "@/types";

// POST /api/calendar — create one or more events
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const sessions: WorkoutSession[] = body.sessions;

    if (!Array.isArray(sessions) || sessions.length === 0) {
      return NextResponse.json(
        { error: "No sessions provided" },
        { status: 400 }
      );
    }

    const results: Array<{ id: string; eventId: string }> = [];

    for (const s of sessions) {
      const eventId = await createCalendarEvent(session.accessToken, s);
      results.push({ id: s.id, eventId });
    }

    // Persist accepted sessions to KV so background crons can cross-reference them
    const storedSessions: StoredSession[] = sessions.map((s) => {
      const match = results.find((r) => r.id === s.id);
      return {
        id: s.id,
        calendarEventId: match?.eventId ?? "",
        type: s.type,
        day: s.day,
        startTime: s.startTime,
        endTime: s.endTime,
        startISO: s.startISO,
        endISO: s.endISO,
        completed: false,
      };
    });

    const weekSchedule: StoredWeekSchedule = {
      weekStart: getWeekStart().toISOString().split("T")[0],
      sessions: storedSessions,
      savedAt: new Date().toISOString(),
    };
    await kv.set("schedule:current_week", weekSchedule);

    // Cache Google tokens in KV so background cron jobs can use them
    await storeGoogleTokens(
      session.accessToken,
      session.refreshToken,
      session.expiresAt
    );

    return NextResponse.json({ created: results });
  } catch (error) {
    console.error("Calendar POST error:", error);
    return NextResponse.json(
      { error: "Failed to create events" },
      { status: 500 }
    );
  }
}

// GET /api/calendar — fetch this week's existing TrainSync events
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

    const [events, allEventsByDay, weekSchedule] = await Promise.all([
      fetchWeekEvents(session.accessToken, weekStart, weekEnd),
      fetchAllEventsByDay(session.accessToken, weekStart, weekEnd),
      kv.get<StoredWeekSchedule>("schedule:current_week"),
    ]);

    const completedEventIds = (weekSchedule?.sessions ?? [])
      .filter((s) => s.completed && s.calendarEventId)
      .map((s) => s.calendarEventId);

    return NextResponse.json({ events, allEventsByDay, completedEventIds });
  } catch (error) {
    console.error("Calendar GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
