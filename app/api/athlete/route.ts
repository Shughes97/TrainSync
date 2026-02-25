import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAthleteProfile, setAthleteProfile } from "@/lib/kv";
import { GOALS } from "@/lib/training-config";
import type { AthleteProfile, OneRepMaxes } from "@/types";

const EMPTY_ONE_REP_MAXES: OneRepMaxes = {
  frontSquat: null,
  backSquat: null,
  deadlift: null,
  clean: null,
  snatch: null,
  benchPress: null,
  strictPress: null,
};

function defaultProfile(): AthleteProfile {
  return {
    name: "",
    age: null,
    height: null,
    weight: null,
    maxHR: null,
    restingHR: null,
    trainingAge: null,
    oneRepMaxes: { ...EMPTY_ONE_REP_MAXES },
    oneRepMaxHistory: [],
    personalBests: [],
    goals: GOALS,
    preferredWorkoutWindows: ["morning", "evening"],
    weightUnit: "kg",
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const profile = (await getAthleteProfile()) ?? defaultProfile();
    return NextResponse.json(profile);
  } catch (error) {
    console.error("GET /api/athlete error:", error);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const existing = (await getAthleteProfile()) ?? defaultProfile();

    // Deep merge one level — handles oneRepMaxes partial updates
    const updated: AthleteProfile = {
      ...existing,
      ...body,
      oneRepMaxes: { ...existing.oneRepMaxes, ...(body.oneRepMaxes ?? {}) },
    };

    await setAthleteProfile(updated);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("PATCH /api/athlete error:", error);
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }
}
