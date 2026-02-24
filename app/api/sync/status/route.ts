import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getLastSync,
  getTrainingLoad,
  getRescheduleLog,
  getActivities,
} from "@/lib/kv";
import { isStravaConnected } from "@/lib/strava";
import { getCurrentPhase } from "@/lib/training-config";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [lastSync, trainingLoad, rescheduleLog, activities, stravaConnected] =
    await Promise.all([
      getLastSync(),
      getTrainingLoad(),
      getRescheduleLog(),
      getActivities(),
      isStravaConnected(),
    ]);

  // Always compute both values live — never rely on stale KV data
  const phaseCtx = getCurrentPhase();
  const sessionTarget = phaseCtx?.phase.weeklyPlan.length ?? 5;

  // Count recognised workout types in the rolling 7-day window
  const GYM_TYPES = new Set(["WeightTraining", "Crossfit"]);
  const RECOGNISED = new Set(["WeightTraining", "Crossfit", "Run", "VirtualRun", "Ride", "VirtualRide"]);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentWorkouts = activities.filter((a) => {
    return new Date(a.start_date) >= sevenDaysAgo && RECOGNISED.has(a.type);
  });

  // Deduplicate: one session per day per category (gym / run / bike)
  const seenDayCategory = new Set<string>();
  let dynamicCompleted = 0;
  for (const a of recentWorkouts) {
    const day = a.start_date.substring(0, 10);
    const cat = GYM_TYPES.has(a.type) ? "gym" : a.type === "Run" || a.type === "VirtualRun" ? "run" : "bike";
    const key = `${day}:${cat}`;
    if (!seenDayCategory.has(key)) {
      seenDayCategory.add(key);
      dynamicCompleted++;
    }
  }
  dynamicCompleted = Math.min(dynamicCompleted, sessionTarget);

  const liveTrainingLoad = trainingLoad
    ? { ...trainingLoad, sessionsCompleted: dynamicCompleted, sessionsScheduled: sessionTarget }
    : null;

  // Return most recent 5 reschedule events and 10 activities
  return NextResponse.json({
    lastStravaSync: lastSync.strava,
    lastCalendarCheck: lastSync.calendar,
    trainingLoad: liveTrainingLoad,
    recentReschedules: rescheduleLog.slice(-5).reverse(),
    stravaConnected,
    recentActivities: activities
      .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())
      .slice(0, 10),
  });
}
