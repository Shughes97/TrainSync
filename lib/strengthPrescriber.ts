/**
 * Claude-powered strength session prescription.
 *
 * Generates a personalised open-gym strength session based on:
 *  - Recent CrossFit movement/muscle group history (from enriched sessions)
 *  - What else is in the week (CrossFit days to avoid conflicts)
 *  - Training phase focus
 *  - Days since last strength session
 *
 * Prescriptions are cached in KV as `prescribed:YYYY-MM-DD` so Claude is
 * only called once per session date.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getPrescribedSession, setPrescribedSession } from "./kv";
import { getOpenGymSuggestion } from "./training-config";
import type { EnrichedSession, OpenGymSuggestion } from "@/types";
import type { StoredActivity } from "./kv";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isoDateToDayName(date: string): string {
  return DAY_NAMES[new Date(date + "T12:00:00").getDay()];
}

function buildPrompt(
  date: string,
  phaseFocus: string,
  recentEnriched: (EnrichedSession | null)[],
  recentStrengthActivities: StoredActivity[],
  weekDates: string[],
): string {
  const dayOfWeek = isoDateToDayName(date);

  // Summarise recent CrossFit sessions with movement data
  const crossfitSessions = recentEnriched
    .filter((s): s is EnrichedSession => s?.wod != null)
    .slice(-7); // last 7 sessions with WOD data

  const sessionHistory = crossfitSessions.length > 0
    ? crossfitSessions.map((s) => {
        const muscles = s.wod!.sections
          .flatMap((sec) => sec.dominantMuscleGroups)
          .filter((m, i, arr) => arr.indexOf(m) === i)
          .join(", ");
        const movements = s.wod!.sections
          .flatMap((sec) => sec.movements)
          .filter((m, i, arr) => arr.indexOf(m) === i)
          .slice(0, 6)
          .join(", ");
        return `- ${s.date}: ${s.wod!.sessionType.replace(/_/g, " ")}, muscles: ${muscles || "mixed"}, movements: ${movements || "varied"}`;
      }).join("\n")
    : "No recent CrossFit sessions on record yet.";

  // CrossFit days in the week (excluding the strength day itself)
  const crossfitDays = weekDates
    .filter((d) => d !== date)
    .filter((d) => {
      // We don't know for certain what's on each day here,
      // but we pass all week dates and let Claude reason about adjacency
      return false; // placeholder — we'll pass weekDates separately
    });

  // Simpler: just note which days of the week are in scope
  const weekDayNames = weekDates.map((d) => isoDateToDayName(d)).join(", ");

  // Last strength session
  const lastStrength = recentStrengthActivities[0];
  let strengthNote = "No recent strength session on record.";
  if (lastStrength) {
    const daysAgo = Math.floor(
      (Date.now() - new Date(lastStrength.start_date).getTime()) / (1000 * 60 * 60 * 24)
    );
    const suffer = lastStrength.suffer_score;
    strengthNote = `Last strength session: "${lastStrength.name}" ${daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`}${suffer ? `, effort score ${suffer}` : ""}.`;
  }

  return `You are a strength coach. Prescribe a 45–60 minute open-gym strength session.

Training phase: ${phaseFocus.replace(/_/g, " ")}
Session date: ${date} (${dayOfWeek})
This week covers: ${weekDayNames}

Recent CrossFit sessions (last 14 days):
${sessionHistory}

${strengthNote}

Return ONLY a valid JSON object with no markdown, in this exact shape:
{
  "focus": "short label e.g. Pull — Back & Biceps",
  "exercises": [
    { "name": "Exercise Name", "sets": "3×10" }
  ],
  "note": "one sentence coaching note personalised to the context above"
}

Rules:
- Prescribe 3–5 exercises
- Avoid duplicating movements heavily used in recent CrossFit sessions
- For endurance/taper phases: prioritise posterior chain and single-leg work to support cycling
- For hypertrophy phase: rotate push/pull/legs across sessions
- Keep the note concise and actionable`;
}

export async function getOrGeneratePrescription(
  date: string,
  phaseFocus: string,
  strengthIndex: number,
  recentEnriched: (EnrichedSession | null)[],
  recentStrengthActivities: StoredActivity[],
  weekDates: string[],
): Promise<OpenGymSuggestion> {
  // Return cached prescription if it exists
  const cached = await getPrescribedSession(date);
  if (cached) return cached;

  // Try Claude
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = buildPrompt(date, phaseFocus, recentEnriched, recentStrengthActivities, weekDates);

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text : "";
    // Strip any accidental markdown fences
    const cleaned = rawText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const suggestion = JSON.parse(cleaned) as OpenGymSuggestion;

    // Basic validation
    if (!suggestion.focus || !Array.isArray(suggestion.exercises) || !suggestion.note) {
      throw new Error("Invalid shape");
    }

    await setPrescribedSession(date, suggestion);
    return suggestion;
  } catch (err) {
    console.warn("[strengthPrescriber] Claude call failed, using static fallback:", err);
    // Fall back to the static phase-based suggestion
    const fallback = getOpenGymSuggestion(phaseFocus, strengthIndex);
    if (fallback) {
      await setPrescribedSession(date, fallback);
      return fallback;
    }
    // Last resort
    return {
      focus: "Full Body",
      exercises: [
        { name: "Deadlifts", sets: "3×5" },
        { name: "Push-ups", sets: "3×15" },
        { name: "Goblet Squats", sets: "3×12" },
      ],
      note: "Keep it simple and focus on form.",
    };
  }
}
