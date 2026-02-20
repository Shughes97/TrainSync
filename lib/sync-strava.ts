/**
 * Strava sync business logic (shared by cron + manual trigger).
 *
 * 1. Fetch the last 60 days of activities from Strava
 * 2. Store cleaned activity list in KV
 * 3. Cross-reference with schedule:current_week → mark completed sessions
 * 4. Compute training load for the current week and store in KV
 */

import { kv } from "@vercel/kv";
import { fetchAndStoreActivities, stravaTypeToWorkout } from "./strava";
import { getWeekSchedule, type TrainingLoad } from "./kv";
import { getCurrentPhase } from "./training-config";
import { getWeekStart } from "./scheduler";

export interface StravaSyncResult {
  activitiesCount: number;
  completedSessions: number;
  trainingLoad: TrainingLoad;
}

export async function runStravaSync(accessToken: string): Promise<StravaSyncResult> {
  // 1. Fetch + store activities
  const activities = await fetchAndStoreActivities(accessToken);

  // 2. Cross-reference with current week schedule
  const weekSchedule = await getWeekSchedule();
  let completedSessions = 0;

  if (weekSchedule) {
    const updatedSessions = weekSchedule.sessions.map((session) => {
      const matchingActivity = activities.find((activity) => {
        const activityDay = activity.start_date.substring(0, 10);
        const workoutType = stravaTypeToWorkout(activity.type);
        return activityDay === session.day && workoutType === session.type;
      });

      if (matchingActivity) {
        completedSessions++;
        return { ...session, completed: true };
      }
      return session;
    });

    await kv.set("schedule:current_week", {
      ...weekSchedule,
      sessions: updatedSessions,
    });
  }

  // 3. Compute this-week training load
  const weekStart = getWeekStart();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const thisWeek = activities.filter((a) => {
    const d = new Date(a.start_date);
    return d >= weekStart && d < weekEnd;
  });

  const weekBikeMiles = thisWeek
    .filter((a) => a.type === "Ride" || a.type === "VirtualRide")
    .reduce((sum, a) => sum + a.distance, 0);

  const weekRunMiles = thisWeek
    .filter((a) => a.type === "Run" || a.type === "VirtualRun")
    .reduce((sum, a) => sum + a.distance, 0);

  const weekGymSecs = thisWeek
    .filter((a) => a.type === "WeightTraining" || a.type === "Crossfit")
    .reduce((sum, a) => sum + a.moving_time, 0);

  const rides = thisWeek.filter((a) => a.type === "Ride" || a.type === "VirtualRide");
  const longestRideMiles = rides.length > 0 ? Math.max(...rides.map((a) => a.distance)) : 0;

  const phaseCtx = getCurrentPhase();
  const longRideTarget = phaseCtx?.phase.longRideTargetMiles ?? 0;

  const trainingLoad: TrainingLoad = {
    weekBikeMiles: Math.round(weekBikeMiles * 10) / 10,
    weekRunMiles: Math.round(weekRunMiles * 10) / 10,
    weekGymMins: Math.round(weekGymSecs / 60),
    sessionsCompleted: completedSessions,
    sessionsScheduled: weekSchedule?.sessions.length ?? 0,
    longRideTargetHit: longRideTarget > 0 && longestRideMiles >= longRideTarget * 0.9,
    longestRideMiles: Math.round(longestRideMiles * 10) / 10,
  };

  await Promise.all([
    kv.set("strava:training_load", trainingLoad),
    kv.set("strava:last_sync", new Date().toISOString()),
  ]);

  return { activitiesCount: activities.length, completedSessions, trainingLoad };
}
