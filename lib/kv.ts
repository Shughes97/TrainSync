/**
 * Vercel KV helpers — all KV access goes through here.
 *
 * Falls back gracefully when KV env vars are absent (local dev without Redis).
 * Required env vars (auto-provisioned by Vercel KV):
 *   KV_REST_API_URL, KV_REST_API_TOKEN
 */

import { kv } from "@vercel/kv";
import type { WodifyParsed, EnrichedSession, OpenGymSuggestion, AthleteProfile, FatigueSnapshot, SleepEntry, RestingHREntry } from "@/types";

export { kv };

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface StoredActivity {
  id: number;
  type: string;       // "Ride", "Run", "WeightTraining", "Crossfit", etc.
  name: string;
  distance: number;   // miles (converted from metres)
  moving_time: number; // seconds
  start_date: string; // ISO datetime
  suffer_score: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  calories: number | null;
}

export interface StoredSession {
  id: string;
  calendarEventId: string;
  type: string; // WorkoutType
  day: string;  // YYYY-MM-DD
  startTime: string;
  endTime: string;
  startISO: string;
  endISO: string;
  completed?: boolean;
}

export interface StoredWeekSchedule {
  weekStart: string;
  sessions: StoredSession[];
  savedAt: string;
}

export interface TrainingLoad {
  weekBikeKm: number;
  weekRunKm: number;
  weekCrossfitMins: number;
  weekStrengthMins: number;
  sessionsCompleted: number;
  sessionsScheduled: number;
  longRideTargetHit: boolean;
  longestRideKm: number;
}

export interface RescheduleEvent {
  timestamp: string;
  sessionType: string;
  originalDay: string;
  originalTime: string;
  newDay: string;
  newTime: string;
  conflictWith: string;
}

// ─── Type-safe helpers ────────────────────────────────────────────────────────

async function safeGet<T>(key: string): Promise<T | null> {
  try {
    return await kv.get<T>(key);
  } catch {
    return null;
  }
}

export async function getActivities(): Promise<StoredActivity[]> {
  return (await safeGet<StoredActivity[]>("strava:activities")) ?? [];
}

export async function getWeekSchedule(): Promise<StoredWeekSchedule | null> {
  return safeGet<StoredWeekSchedule>("schedule:current_week");
}

export async function getRescheduleLog(): Promise<RescheduleEvent[]> {
  return (await safeGet<RescheduleEvent[]>("schedule:reschedule_log")) ?? [];
}

export async function getTrainingLoad(): Promise<TrainingLoad | null> {
  return safeGet<TrainingLoad>("strava:training_load");
}

export async function getLastSync(): Promise<{
  strava: string | null;
  calendar: string | null;
}> {
  try {
    const [strava, calendar] = await Promise.all([
      kv.get<string>("strava:last_sync"),
      kv.get<string>("schedule:last_calendar_check"),
    ]);
    return { strava: strava ?? null, calendar: calendar ?? null };
  } catch {
    return { strava: null, calendar: null };
  }
}

export async function getGoogleAccessToken(): Promise<string | null> {
  try {
    const [token, expiresAt, refreshToken] = await Promise.all([
      kv.get<string>("google:access_token"),
      kv.get<number>("google:token_expires_at"),
      kv.get<string>("google:refresh_token"),
    ]);

    // Token valid with 60-second buffer
    if (token && expiresAt && Date.now() / 1000 < expiresAt - 60) {
      return token;
    }

    // Try to refresh
    if (!refreshToken) return token ?? null;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) return token ?? null;

    const refreshed = await res.json();
    await Promise.all([
      kv.set("google:access_token", refreshed.access_token),
      kv.set("google:token_expires_at", Math.floor(Date.now() / 1000) + refreshed.expires_in),
    ]);
    return refreshed.access_token as string;
  } catch {
    return null;
  }
}

export async function storeGoogleTokens(
  accessToken: string,
  refreshToken: string | undefined,
  expiresAt: number | undefined
): Promise<void> {
  try {
    const ops: Promise<unknown>[] = [kv.set("google:access_token", accessToken)];
    if (refreshToken) ops.push(kv.set("google:refresh_token", refreshToken));
    if (expiresAt) ops.push(kv.set("google:token_expires_at", expiresAt));
    await Promise.all(ops);
  } catch {
    // KV unavailable in local dev — silently ignore
  }
}

export async function appendRescheduleLog(event: RescheduleEvent): Promise<void> {
  try {
    const log = await getRescheduleLog();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const trimmed = log.filter((e) => new Date(e.timestamp).getTime() > cutoff);
    trimmed.push(event);
    await kv.set("schedule:reschedule_log", trimmed);
  } catch {
    // silently ignore
  }
}

// ─── Wodify + Enriched Session helpers ───────────────────────────────────────

export async function getWodifyData(date: string): Promise<WodifyParsed | null> {
  return safeGet<WodifyParsed>(`wodify:${date}`);
}

export async function setWodifyData(date: string, data: WodifyParsed): Promise<void> {
  try {
    await kv.set(`wodify:${date}`, data);
  } catch {
    // silently ignore
  }
}

export async function getEnrichedSession(date: string): Promise<EnrichedSession | null> {
  return safeGet<EnrichedSession>(`session:${date}`);
}

export async function setEnrichedSession(date: string, session: EnrichedSession): Promise<void> {
  try {
    await kv.set(`session:${date}`, session);
  } catch {
    // silently ignore
  }
}

// ─── Prescribed session helpers ───────────────────────────────────────────────

export async function getPrescribedSession(date: string): Promise<OpenGymSuggestion | null> {
  return safeGet<OpenGymSuggestion>(`prescribed:${date}`);
}

export async function setPrescribedSession(date: string, suggestion: OpenGymSuggestion): Promise<void> {
  try {
    await kv.set(`prescribed:${date}`, suggestion);
  } catch {
    // silently ignore
  }
}

export async function clearUncompletedPrescriptions(): Promise<void> {
  try {
    const [, keys] = await kv.scan(0, { match: "prescribed:*", count: 100 });
    if (!keys || keys.length === 0) return;
    for (const key of keys) {
      try {
        const date = (key as string).replace("prescribed:", "");
        const enriched = await getEnrichedSession(date);
        if (!enriched) await kv.del(key as string);
      } catch {
        // skip individual failures silently
      }
    }
  } catch {
    // silently ignore if KV unavailable
  }
}

export async function getRecentEnrichedSessions(days: number): Promise<(EnrichedSession | null)[]> {
  const today = new Date();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
  }
  return Promise.all(dates.map((date) => getEnrichedSession(date)));
}

// ─── Athlete profile helpers ──────────────────────────────────────────────────

export async function getAthleteProfile(): Promise<AthleteProfile | null> {
  return safeGet<AthleteProfile>("athlete:profile");
}

export async function setAthleteProfile(profile: AthleteProfile): Promise<void> {
  try {
    await kv.set("athlete:profile", profile);
  } catch {
    // silently ignore if KV unavailable
  }
}

// ─── Fatigue snapshot helpers ─────────────────────────────────────────────────

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function getFatigueSnapshot(date?: string): Promise<FatigueSnapshot | null> {
  const key = `fatigue:snapshot:${date ?? isoDate(new Date())}`;
  return safeGet<FatigueSnapshot>(key);
}

export async function setFatigueSnapshot(snapshot: FatigueSnapshot): Promise<void> {
  try {
    await Promise.all([
      kv.set(`fatigue:snapshot:${snapshot.date}`, snapshot),
      kv.set(`fatigue:neuromuscular:${snapshot.date}`, snapshot.neuromuscular.score),
      kv.set(`fatigue:cardiovascular:${snapshot.date}`, snapshot.cardiovascular.score),
      kv.set(`fatigue:metabolic:${snapshot.date}`, snapshot.metabolic.score),
    ]);
  } catch {
    // silently ignore if KV unavailable
  }
}

// ─── Sleep helpers ────────────────────────────────────────────────────────────

export async function getSleepEntry(date: string): Promise<SleepEntry | null> {
  return safeGet<SleepEntry>(`sleep:data:${date}`);
}

export async function setSleepEntry(entry: SleepEntry): Promise<void> {
  try {
    await kv.set(`sleep:data:${entry.date}`, entry);
  } catch {
    // silently ignore if KV unavailable
  }
}

// ─── Resting HR helpers ───────────────────────────────────────────────────────

export async function getRestingHREntry(date: string): Promise<RestingHREntry | null> {
  return safeGet<RestingHREntry>(`health:resting-hr:${date}`);
}

export async function setRestingHREntry(entry: RestingHREntry): Promise<void> {
  try {
    await kv.set(`health:resting-hr:${entry.date}`, entry);
  } catch {
    // silently ignore if KV unavailable
  }
}
