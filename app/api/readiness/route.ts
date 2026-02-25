import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFatigueSnapshot, setFatigueSnapshot } from "@/lib/kv";
import { computeFatigueSnapshot } from "@/lib/fatigue";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = isoDate(new Date());

    // Serve cached snapshot if available and schema is current (has sleep field)
    const cached = await getFatigueSnapshot(today);
    if (cached && cached.sleep) {
      return NextResponse.json(cached);
    }

    // First request of the day — compute fresh
    const snapshot = await computeFatigueSnapshot();
    await setFatigueSnapshot(snapshot);
    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("[readiness] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
