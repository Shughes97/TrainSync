import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { getAthleteProfile, setAthleteProfile, getEnrichedSession, setEnrichedSession } from "@/lib/kv";
import { calculateNeuromuscularLoad, normalizeNeuromuscularLoad } from "@/lib/neuromuscularLoad";
import type { LiftKey, OneRepMaxEntry, PersonalBest, ParsedSessionNotes } from "@/types";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { date, notes, wodContext } = body as {
    date?: string;
    notes?: string;
    wodContext?: object;
  };

  if (!notes?.trim()) {
    return NextResponse.json({ error: "No notes provided" }, { status: 400 });
  }

  const sessionDate = date ?? todayISO();

  // ─── Call Claude to parse the notes ─────────────────────────────────────────

  let parsed: ParsedSessionNotes;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `You are a strength training analyst. Parse the user's session notes and extract structured data.
WOD context: ${JSON.stringify(wodContext ?? {})}

User notes: "${notes}"

Extract lifts, weights (all in kg), rep ranges, RPE/sentiment, injury mentions.
Use camelCase lift keys: frontSquat, backSquat, deadlift, clean, snatch, benchPress, strictPress.

Return ONLY valid JSON — no markdown:
{
  "liftData": [{ "lift": "frontSquat", "topSetWeight": 82.5, "topSetReps": 3, "estimatedOneRM": null, "rpe": 8 }],
  "metconNotes": { "weight": null, "scaling": null, "feeling": "good" },
  "sessionRPE": 7,
  "sentiment": "positive",
  "injuryFlag": false,
  "injuryNotes": null
}`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text : "";
    const cleaned = rawText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned) as ParsedSessionNotes;
  } catch (err) {
    console.warn("[parse-notes] Claude parse failed:", err);
    return NextResponse.json({ error: "Failed to parse notes" }, { status: 422 });
  }

  // ─── Calculate 1RM estimates ─────────────────────────────────────────────────

  const LIFT_KEYS = new Set<string>([
    "frontSquat", "backSquat", "deadlift", "clean", "snatch", "benchPress", "strictPress",
  ]);

  parsed.liftData = parsed.liftData.map((lift) => ({
    ...lift,
    estimatedOneRM: lift.topSetWeight && lift.topSetReps
      ? Math.round(lift.topSetWeight * (1 + lift.topSetReps / 30) * 10) / 10
      : null,
  }));

  // ─── Update athlete profile (1RMs + personal bests) ─────────────────────────

  const profile = await getAthleteProfile();
  const newPersonalBests: PersonalBest[] = [];

  if (profile) {
    let profileDirty = false;

    for (const lift of parsed.liftData) {
      if (!LIFT_KEYS.has(lift.lift) || !lift.estimatedOneRM) continue;

      const liftKey = lift.lift as LiftKey;
      const current1RM = profile.oneRepMaxes[liftKey];

      if (current1RM == null || lift.estimatedOneRM > current1RM) {
        profile.oneRepMaxes[liftKey] = lift.estimatedOneRM;

        const entry: OneRepMaxEntry = {
          lift: lift.lift,
          estimatedMax: lift.estimatedOneRM,
          date: sessionDate,
          source: "session_log",
          notes: `Top set: ${lift.topSetWeight}kg × ${lift.topSetReps}`,
        };
        profile.oneRepMaxHistory.push(entry);
        profileDirty = true;

        // Check personal bests (highest weight lifted, not estimated 1RM)
        const existingPB = profile.personalBests.find((pb) => pb.lift === lift.lift);
        if (!existingPB || lift.topSetWeight > existingPB.weight ||
            (lift.topSetWeight === existingPB.weight && lift.topSetReps > existingPB.reps)) {
          const newPB: PersonalBest = {
            lift: lift.lift,
            weight: lift.topSetWeight,
            reps: lift.topSetReps,
            date: sessionDate,
            sessionId: `session:${sessionDate}`,
          };
          const pbIdx = profile.personalBests.findIndex((pb) => pb.lift === lift.lift);
          if (pbIdx >= 0) {
            profile.personalBests[pbIdx] = newPB;
          } else {
            profile.personalBests.push(newPB);
          }
          newPersonalBests.push(newPB);
          profileDirty = true;
        }
      }
    }

    if (profileDirty) {
      await setAthleteProfile(profile);
    }
  }

  // ─── Calculate and store neuromuscular load ──────────────────────────────────

  const enrichedSession = await getEnrichedSession(sessionDate);

  if (enrichedSession && parsed.liftData.length > 0 && profile) {
    const rawLoad = calculateNeuromuscularLoad(parsed.liftData, profile.oneRepMaxes);
    const normalizedLoad = await normalizeNeuromuscularLoad(rawLoad);

    const updatedSession = {
      ...enrichedSession,
      neuromuscularLoad: normalizedLoad,
      // Update enrichedIntensity if we now have better data from actual weights
      enrichedIntensity: Math.max(
        enrichedSession.enrichedIntensity ?? 0,
        Math.round(normalizedLoad / 10)
      ),
      sessionNotes: { raw: notes, parsed },
      newPersonalBests: newPersonalBests.length > 0 ? newPersonalBests : undefined,
    };

    await setEnrichedSession(sessionDate, updatedSession);
  }

  // Fire-and-forget fatigue recalculation so readiness updates immediately
  try {
    const { computeFatigueSnapshot } = await import("@/lib/fatigue");
    const { setFatigueSnapshot } = await import("@/lib/kv");
    computeFatigueSnapshot().then((snap) => setFatigueSnapshot(snap)).catch(() => {});
  } catch {
    // non-critical — don't block the response
  }

  return NextResponse.json({ parsed, newPersonalBests });
}
