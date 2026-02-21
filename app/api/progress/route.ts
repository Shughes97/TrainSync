import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getActivities } from "@/lib/kv";

interface DayBar {
  label: string;   // e.g. "Mon 16 Feb"
  date: string;    // YYYY-MM-DD
  bikeH: number;
  runH: number;
  crossfitH: number;
  strengthH: number;
}

interface WeekBar {
  label: string;   // e.g. "16 Feb"
  weekStart: string; // YYYY-MM-DD
  bikeH: number;
  runH: number;
  crossfitH: number;
  strengthH: number;
}

function secsToHours(s: number): number {
  return Math.round((s / 3600) * 10) / 10;
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activities = await getActivities();

  // ── Weekly view: last 14 days, one bar per day ──────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dailyMap: Record<string, { bikeS: number; runS: number; crossfitS: number; strengthS: number }> = {};

  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dailyMap[isoDate(d)] = { bikeS: 0, runS: 0, crossfitS: 0, strengthS: 0 };
  }

  for (const a of activities) {
    const day = a.start_date.substring(0, 10);
    if (!dailyMap[day]) continue;
    const t = a.moving_time;
    if (a.type === "Ride" || a.type === "VirtualRide") dailyMap[day].bikeS += t;
    else if (a.type === "Run" || a.type === "VirtualRun") dailyMap[day].runS += t;
    else if (a.type === "Crossfit") dailyMap[day].crossfitS += t;
    else if (a.type === "WeightTraining") dailyMap[day].strengthS += t;
  }

  const weekly: DayBar[] = Object.entries(dailyMap).map(([date, v]) => {
    const d = new Date(date + "T12:00:00");
    const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    return {
      label,
      date,
      bikeH: secsToHours(v.bikeS),
      runH: secsToHours(v.runS),
      crossfitH: secsToHours(v.crossfitS),
      strengthH: secsToHours(v.strengthS),
    };
  });

  // ── Monthly view: last 12 weeks, one bar per week ───────────────────────────
  // Week starts on Monday
  const thisMonday = new Date(today);
  const dow = today.getDay(); // 0=Sun
  const daysToMonday = dow === 0 ? 6 : dow - 1;
  thisMonday.setDate(today.getDate() - daysToMonday);

  const weeklyMap: Record<string, { bikeS: number; runS: number; crossfitS: number; strengthS: number; label: string }> = {};

  for (let i = 11; i >= 0; i--) {
    const monday = new Date(thisMonday);
    monday.setDate(thisMonday.getDate() - i * 7);
    const key = isoDate(monday);
    const label = monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    weeklyMap[key] = { bikeS: 0, runS: 0, crossfitS: 0, strengthS: 0, label };
  }

  for (const a of activities) {
    const actDate = new Date(a.start_date);
    actDate.setHours(0, 0, 0, 0);
    const dow2 = actDate.getDay();
    const offset = dow2 === 0 ? 6 : dow2 - 1;
    const monday = new Date(actDate);
    monday.setDate(actDate.getDate() - offset);
    const key = isoDate(monday);
    if (!weeklyMap[key]) continue;
    const t = a.moving_time;
    if (a.type === "Ride" || a.type === "VirtualRide") weeklyMap[key].bikeS += t;
    else if (a.type === "Run" || a.type === "VirtualRun") weeklyMap[key].runS += t;
    else if (a.type === "Crossfit") weeklyMap[key].crossfitS += t;
    else if (a.type === "WeightTraining") weeklyMap[key].strengthS += t;
  }

  const monthly: WeekBar[] = Object.entries(weeklyMap).map(([weekStart, v]) => ({
    label: v.label,
    weekStart,
    bikeH: secsToHours(v.bikeS),
    runH: secsToHours(v.runS),
    crossfitH: secsToHours(v.crossfitS),
    strengthH: secsToHours(v.strengthS),
  }));

  return NextResponse.json({ weekly, monthly });
}
