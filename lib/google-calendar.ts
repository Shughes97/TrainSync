/**
 * Google Calendar API helpers
 */

import { google } from "googleapis";
import type { BusySlot, CalEventsByDay, WorkoutSession } from "@/types";

function getOAuth2Client(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken });
  return oauth2Client;
}

/**
 * Fetch busy time slots for the next 7 days from all user calendars.
 */
export async function fetchBusySlots(
  accessToken: string,
  timeMin: Date,
  timeMax: Date
): Promise<BusySlot[]> {
  const auth = getOAuth2Client(accessToken);
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: "primary" }],
    },
  });

  const calendars = response.data.calendars;
  if (!calendars) return [];

  const busy: BusySlot[] = [];
  for (const cal of Object.values(calendars)) {
    if (cal.busy) {
      for (const slot of cal.busy) {
        if (slot.start && slot.end) {
          busy.push({ start: slot.start, end: slot.end });
        }
      }
    }
  }

  return busy;
}

/**
 * Create a single workout calendar event.
 */
export async function createCalendarEvent(
  accessToken: string,
  session: WorkoutSession
): Promise<string> {
  const auth = getOAuth2Client(accessToken);
  const calendar = google.calendar({ version: "v3", auth });

  const titles: Record<string, string> = {
    Crossfit: "🏋️ CrossFit Session",
    Strength: "💪 Strength Training",
    Run: "🏃 Run",
    Bike: "🚴 Bike Ride",
  };

  const descriptions: Record<string, string> = {
    Crossfit: "CrossFit workout — scheduled by TrainSync",
    Strength: "Strength training session — scheduled by TrainSync",
    Run: "Running session — scheduled by TrainSync",
    Bike: "Cycling session — scheduled by TrainSync",
  };

  const colors: Record<string, string> = {
    Crossfit: "11", // Tomato
    Strength: "6",  // Tangerine
    Run: "2",       // Sage
    Bike: "7",      // Peacock
  };

  const event = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: titles[session.type] ?? session.type,
      description: descriptions[session.type] ?? "Workout — scheduled by TrainSync",
      colorId: colors[session.type],
      start: {
        dateTime: session.startISO,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: session.endISO,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 15 }],
      },
    },
  });

  return event.data.id ?? "";
}

/**
 * Fetch ALL calendar events for the week, grouped by day (YYYY-MM-DD).
 * Used to render the day preview timeline on each workout card.
 * Skips all-day events (no dateTime).
 */
export async function fetchAllEventsByDay(
  accessToken: string,
  timeMin: Date,
  timeMax: Date
): Promise<CalEventsByDay> {
  const auth = getOAuth2Client(accessToken);
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });

  const byDay: CalEventsByDay = {};

  for (const evt of response.data.items ?? []) {
    const startDateTime = evt.start?.dateTime;
    const endDateTime = evt.end?.dateTime;
    if (!startDateTime || !endDateTime) continue; // skip all-day events

    const dayStr = startDateTime.substring(0, 10);
    if (!byDay[dayStr]) byDay[dayStr] = [];

    byDay[dayStr].push({
      id: evt.id ?? "",
      summary: evt.summary ?? "(No title)",
      start: startDateTime,
      end: endDateTime,
    });
  }

  return byDay;
}

/**
 * Update the start/end time of an existing calendar event.
 * Used by the calendar-sync cron when a conflict triggers a reschedule.
 */
export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  newStartISO: string,
  newEndISO: string
): Promise<void> {
  const auth = getOAuth2Client(accessToken);
  const calendar = google.calendar({ version: "v3", auth });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Fetch existing event to preserve all other fields
  const existing = await calendar.events.get({
    calendarId: "primary",
    eventId,
  });

  await calendar.events.update({
    calendarId: "primary",
    eventId,
    requestBody: {
      ...existing.data,
      start: { dateTime: newStartISO, timeZone: tz },
      end: { dateTime: newEndISO, timeZone: tz },
    },
  });
}

/**
 * Fetch ALL calendar events for a 14-day window (used by conflict detection cron).
 */
export async function fetchEventsForWindow(
  accessToken: string,
  timeMin: Date,
  timeMax: Date
): Promise<Array<{ id: string; summary: string; start: string; end: string }>> {
  const auth = getOAuth2Client(accessToken);
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 500,
  });

  return (response.data.items ?? [])
    .filter((evt) => evt.start?.dateTime && evt.end?.dateTime)
    .map((evt) => ({
      id: evt.id ?? "",
      summary: evt.summary ?? "(No title)",
      start: evt.start!.dateTime!,
      end: evt.end!.dateTime!,
    }));
}

/**
 * Delete a calendar event by ID.
 */
export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string
): Promise<void> {
  const auth = getOAuth2Client(accessToken);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId: "primary", eventId });
}

/**
 * Fetch existing TrainSync workout events for the current week.
 */
export async function fetchWeekEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date
): Promise<Array<{ id: string; summary: string; start: string; end: string }>> {
  const auth = getOAuth2Client(accessToken);
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    q: "TrainSync",
  });

  return (response.data.items ?? []).map((evt) => ({
    id: evt.id ?? "",
    summary: evt.summary ?? "",
    start: evt.start?.dateTime ?? evt.start?.date ?? "",
    end: evt.end?.dateTime ?? evt.end?.date ?? "",
  }));
}
