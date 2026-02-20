/**
 * Strava API client helpers.
 * Tokens are stored in Vercel KV and auto-refreshed as needed.
 */

import { kv } from "@vercel/kv";
import type { StoredActivity } from "./kv";

// ─── Token management ─────────────────────────────────────────────────────────

export async function getStravaAccessToken(): Promise<string | null> {
  try {
    const [token, expiresAt, refreshToken] = await Promise.all([
      kv.get<string>("strava:access_token"),
      kv.get<number>("strava:token_expires_at"),
      kv.get<string>("strava:refresh_token"),
    ]);

    if (!token && !refreshToken) return null;

    // Still valid (60-second buffer)
    if (token && expiresAt && Date.now() / 1000 < expiresAt - 60) return token;

    if (!refreshToken) return token ?? null;

    // Refresh
    const res = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) return token ?? null;

    const data = await res.json();
    await Promise.all([
      kv.set("strava:access_token", data.access_token),
      kv.set("strava:token_expires_at", data.expires_at),
      kv.set("strava:refresh_token", data.refresh_token),
    ]);
    return data.access_token as string;
  } catch {
    return null;
  }
}

export async function isStravaConnected(): Promise<boolean> {
  try {
    const token = await kv.get<string>("strava:access_token");
    return token !== null;
  } catch {
    return false;
  }
}

// ─── Activity fetching ────────────────────────────────────────────────────────

function metersToKm(m: number): number {
  return Math.round((m / 1000) * 10) / 10;
}

/** Fetch the last 60 days of Strava activities and clean them up for storage. */
export async function fetchAndStoreActivities(accessToken: string): Promise<StoredActivity[]> {
  const sixtyDaysAgo = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;

  const res = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=60&after=${sixtyDaysAgo}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Strava API ${res.status}: ${await res.text()}`);

  const raw: Array<{
    id: number;
    type: string;
    name: string;
    distance: number;
    moving_time: number;
    start_date: string;
    suffer_score: number | null;
    average_heartrate: number | null;
  }> = await res.json();

  const activities: StoredActivity[] = raw.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    distance: metersToKm(a.distance),
    moving_time: a.moving_time,
    start_date: a.start_date,
    suffer_score: a.suffer_score ?? null,
    average_heartrate: a.average_heartrate ?? null,
  }));

  await kv.set("strava:activities", activities);
  return activities;
}

// ─── Type mapping ─────────────────────────────────────────────────────────────

/** Maps a Strava activity type to the corresponding TrainSync WorkoutType. */
export function stravaTypeToWorkout(stravaType: string): string | null {
  switch (stravaType) {
    case "Ride":
    case "VirtualRide":
      return "Bike";
    case "Run":
    case "VirtualRun":
      return "Run";
    case "WeightTraining":
    case "Crossfit":
      return "Strength";
    default:
      return null;
  }
}
