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

  // Return most recent 5 reschedule events and 10 activities
  return NextResponse.json({
    lastStravaSync: lastSync.strava,
    lastCalendarCheck: lastSync.calendar,
    trainingLoad,
    recentReschedules: rescheduleLog.slice(-5).reverse(),
    stravaConnected,
    recentActivities: activities
      .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())
      .slice(0, 10),
  });
}
