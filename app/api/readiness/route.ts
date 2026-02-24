import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { computeReadiness } from "@/lib/readiness";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const readiness = await computeReadiness();
    return NextResponse.json(readiness);
  } catch (err) {
    console.error("[readiness] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
