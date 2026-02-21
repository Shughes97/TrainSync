import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { deleteCalendarEvent, updateCalendarEvent } from "@/lib/google-calendar";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await deleteCalendarEvent(session.accessToken, params.eventId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[calendar/[eventId] DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { startISO, endISO } = await req.json();
    await updateCalendarEvent(session.accessToken, params.eventId, startISO, endISO);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[calendar/[eventId] PATCH]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
