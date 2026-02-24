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
import { updateCalendarEvent } from "./google-calendar";
import { resolvePendingSessions, resolvePrescribedSessions } from "./sessionMatcher";

// WeightTraining, Crossfit, and Workout on Strava all map to gym sessions.
// Treat all as interchangeable with scheduled Crossfit/Strength sessions.
const GYM_TYPES = new Set(["Strength", "Crossfit", "Workout"]);

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
    const updatedSessions = [];

    for (const session of weekSchedule.sessions) {
      const matchingActivity = activities.find((activity) => {
        const activityDay = activity.start_date.substring(0, 10);
        const workoutType = stravaTypeToWorkout(activity.type);
        if (activityDay !== session.day || !workoutType) return false;
        // Exact type match, or both are gym sessions (Strength ↔ Crossfit)
        return workoutType === session.type ||
          (GYM_TYPES.has(workoutType) && GYM_TYPES.has(session.type));
      });

      if (matchingActivity) {
        completedSessions++;

        // If actual activity time differs from scheduled by >30 min, move the calendar event
        if (session.calendarEventId) {
          const actualStart = new Date(matchingActivity.start_date);
          const scheduledStart = new Date(session.startISO);
          const timeDiffMs = Math.abs(actualStart.getTime() - scheduledStart.getTime());

          if (timeDiffMs > 30 * 60 * 1000) {
            const durationMs = Math.min(matchingActivity.moving_time * 1000, 2 * 60 * 60 * 1000);
            const actualEnd = new Date(actualStart.getTime() + durationMs);
            try {
              await updateCalendarEvent(
                accessToken,
                session.calendarEventId,
                actualStart.toISOString(),
                actualEnd.toISOString()
              );
            } catch (e) {
              console.error("Failed to move calendar event to actual time:", e);
            }
          }
        }

        updatedSessions.push({ ...session, completed: true });
      } else {
        updatedSessions.push(session);
      }
    }

    await kv.set("schedule:current_week", {
      ...weekSchedule,
      sessions: updatedSessions,
    });
  }

  // 3. Compute rolling 7-day training load
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const thisWeek = activities.filter((a) => {
    const d = new Date(a.start_date);
    return d >= sevenDaysAgo;
  });

  const weekBikeKm = thisWeek
    .filter((a) => a.type === "Ride" || a.type === "VirtualRide")
    .reduce((sum, a) => sum + a.distance, 0);

  const weekRunKm = thisWeek
    .filter((a) => a.type === "Run" || a.type === "VirtualRun")
    .reduce((sum, a) => sum + a.distance, 0);

  const weekCrossfitSecs = thisWeek
    .filter((a) => a.type === "Crossfit")
    .reduce((sum, a) => sum + a.moving_time, 0);

  const weekStrengthSecs = thisWeek
    .filter((a) => a.type === "WeightTraining")
    .reduce((sum, a) => sum + a.moving_time, 0);

  const rides = thisWeek.filter((a) => a.type === "Ride" || a.type === "VirtualRide");
  const longestRideKm = rides.length > 0 ? Math.max(...rides.map((a) => a.distance)) : 0;

  const phaseCtx = getCurrentPhase();
  const longRideTargetKm = phaseCtx?.phase.longRideTargetKm ?? 0;

  const trainingLoad: TrainingLoad = {
    weekBikeKm: Math.round(weekBikeKm * 10) / 10,
    weekRunKm: Math.round(weekRunKm * 10) / 10,
    weekCrossfitMins: Math.round(weekCrossfitSecs / 60),
    weekStrengthMins: Math.round(weekStrengthSecs / 60),
    sessionsCompleted: completedSessions,
    sessionsScheduled: phaseCtx?.phase.weeklyPlan.length ?? 5,
    longRideTargetHit: longRideTargetKm > 0 && longestRideKm >= longRideTargetKm * 0.9,
    longestRideKm: Math.round(longestRideKm * 10) / 10,
  };

  await Promise.all([
    kv.set("strava:training_load", trainingLoad),
    kv.set("strava:last_sync", new Date().toISOString()),
  ]);

  // Resolve any Wodify sessions uploaded before the class synced to Strava
  await resolvePendingSessions();
  // Resolve any open-gym strength sessions that now have a matching Strava activity
  await resolvePrescribedSessions();

  return { activitiesCount: activities.length, completedSessions, trainingLoad };
}
