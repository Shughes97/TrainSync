/**
 * POST /api/fatigue/recalculate
 * On-demand fatigue recalculation — called after a session is logged or notes parsed.
 * Requires an authenticated NextAuth session.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { computeFatigueSnapshot } from "@/lib/fatigue";
import { setFatigueSnapshot } from "@/lib/kv";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await computeFatigueSnapshot();
    await setFatigueSnapshot(snapshot);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    console.error("[fatigue/recalculate] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
