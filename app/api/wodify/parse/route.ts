import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { setWodifyData } from "@/lib/kv";
import { matchAndEnrichSession } from "@/lib/sessionMatcher";
import type { WodifyParsed } from "@/types";

const SYSTEM_PROMPT = `You are a CrossFit workout parser. Extract structured data from Wodify app screenshots.
Return ONLY a JSON object with no preamble or markdown, in this exact shape:
{
  "date": "YYYY-MM-DD",
  "box": "gym name",
  "sections": [
    {
      "type": "warmup|weightlifting|metcon|skill|cooldown",
      "name": "section name",
      "description": "full workout description",
      "movements": ["movement1", "movement2"],
      "dominantMuscleGroups": ["quads", "posterior_chain", "push", "pull", "cardio"],
      "estimatedIntensity": "low|moderate|high|very_high",
      "coachingNotes": "any coaching notes visible"
    }
  ],
  "sessionType": "strength_only|metcon_only|strength_and_metcon|skill|endurance",
  "overallLoad": "low|moderate|high|very_high"
}
If the date is not visible in the screenshot, use today's date.`;

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { image, date } = body as { image?: string; date?: string };

  if (!image) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
  const base64 = image.replace(/^data:[^;]+;base64,/, "");
  // Detect media type from data URL or default to jpeg
  const mediaTypeMatch = image.match(/^data:([^;]+);base64,/);
  const mediaType = (mediaTypeMatch?.[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp") ?? "image/jpeg";

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: `Today's date is ${todayISO()}. Parse this Wodify screenshot.` },
          ],
        },
      ],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text : "";

    let parsed: WodifyParsed;
    try {
      parsed = JSON.parse(rawText) as WodifyParsed;
    } catch {
      return NextResponse.json(
        { error: "Failed to parse Claude response as JSON", raw: rawText },
        { status: 422 }
      );
    }

    // If date not in image, Claude uses todayISO() per system prompt;
    // allow override from request body
    if (date) parsed.date = date;

    await setWodifyData(parsed.date, parsed);
    const enriched = await matchAndEnrichSession(parsed.date);

    return NextResponse.json({ parsed, enriched });
  } catch (err) {
    console.error("[wodify/parse] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
