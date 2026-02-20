/**
 * Calendar conflict detection + auto-reschedule logic.
 *
 * For each scheduled TrainSync workout in the next 14 days:
 *   - Check if any other calendar event now overlaps its timeslot
 *   - If so, find the next best free slot on the same or following day
 *   - Update the Google Calendar event and log the reschedule
 *
 * NOTE: Times are compared using Date.getTime() (UTC epoch).
 * TrainSync ISO strings without a timezone offset ("2026-02-20T06:30:00")
 * are treated as UTC by the server runtime. This is consistent with how
 * createCalendarEvent stores them on Vercel (UTC timezone).
 */

import { kv } from "@vercel/kv";
import { fetchEventsForWindow, updateCalendarEvent } from "./google-calendar";
import { findSlotsForDay } from "./scheduler";
import { appendRescheduleLog, type RescheduleEvent } from "./kv";
import type { BusySlot } from "@/types";

const TRAVEL_BUFFER_MS = 30 * 60 * 1000; // 30 minutes in ms

export interface CalendarSyncResult {
  checked: number;
  rescheduled: number;
  noSlotFound: number;
  log: string[];
}

function overlaps(
  s1: string, e1: string,
  s2: string, e2: string
): boolean {
  return new Date(s1).getTime() < new Date(e2).getTime() &&
    new Date(e1).getTime() > new Date(s2).getTime();
}

export async function runCalendarSync(accessToken: string): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = { checked: 0, rescheduled: 0, noSlotFound: 0, log: [] };

  const now = new Date();
  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(now.getDate() + 14);

  // Fetch all calendar events for the next 14 days
  const allEvents = await fetchEventsForWindow(accessToken, now, twoWeeksOut);

  // Separate TrainSync events from "regular" events
  const trainsyncEvents = allEvents.filter((e) => e.summary.includes("TrainSync"));
  const regularEvents = allEvents.filter((e) => !e.summary.includes("TrainSync"));

  for (const tsEvent of trainsyncEvents) {
    result.checked++;

    // Check if any regular event conflicts (with travel buffer)
    const conflictingEvent = regularEvents.find((evt) => {
      const bufferedStart = new Date(new Date(evt.start).getTime() - TRAVEL_BUFFER_MS).toISOString();
      const bufferedEnd = new Date(new Date(evt.end).getTime() + TRAVEL_BUFFER_MS).toISOString();
      return overlaps(tsEvent.start, tsEvent.end, bufferedStart, bufferedEnd);
    });

    if (!conflictingEvent) continue;

    // Conflict found — find a new slot on the same day or the next day
    const tsDay = tsEvent.start.substring(0, 10);

    let newSlot: { startISO: string; endISO: string; startTime: string; endTime: string } | null = null;
    let newDay = tsDay;

    for (let dayOffset = 0; dayOffset <= 1 && !newSlot; dayOffset++) {
      const targetDate = new Date(newDay + "T12:00:00");
      targetDate.setDate(targetDate.getDate() + dayOffset);
      newDay = targetDate.toISOString().substring(0, 10);

      // Build busy slots for that day (exclude the TrainSync event being moved)
      const dayEvents = allEvents.filter(
        (e) => e.start.substring(0, 10) === newDay && e.id !== tsEvent.id
      );
      const busySlots: BusySlot[] = dayEvents.map((e) => ({ start: e.start, end: e.end }));

      const slots = findSlotsForDay(targetDate, busySlots);
      if (slots.length > 0) {
        newSlot = slots[0];
      }
    }

    if (!newSlot) {
      result.noSlotFound++;
      result.log.push(`No replacement slot found for ${tsEvent.summary} on ${tsDay} — conflict: ${conflictingEvent.summary}`);
      continue;
    }

    // Update the Google Calendar event
    try {
      await updateCalendarEvent(accessToken, tsEvent.id, newSlot.startISO, newSlot.endISO);
      result.rescheduled++;

      const originalTime = new Date(tsEvent.start).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const logEntry: RescheduleEvent = {
        timestamp: new Date().toISOString(),
        sessionType: tsEvent.summary,
        originalDay: tsDay,
        originalTime,
        newDay,
        newTime: newSlot.startTime,
        conflictWith: conflictingEvent.summary,
      };
      await appendRescheduleLog(logEntry);

      const msg = `Moved ${tsEvent.summary} from ${tsDay} ${originalTime} → ${newDay} ${newSlot.startTime} (conflict: ${conflictingEvent.summary})`;
      result.log.push(msg);
      console.log("[calendar-sync]", msg);
    } catch (err) {
      result.log.push(`Failed to update ${tsEvent.summary}: ${err}`);
    }
  }

  await kv.set("schedule:last_calendar_check", new Date().toISOString());
  return result;
}
