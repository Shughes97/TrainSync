import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { kv } from "@vercel/kv";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.redirect(new URL("/", process.env.NEXTAUTH_URL!));
  }

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      new URL("/dashboard?strava=denied", process.env.NEXTAUTH_URL!)
    );
  }

  // Exchange code for tokens
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    console.error("Strava token exchange failed:", await res.text());
    return NextResponse.redirect(
      new URL("/dashboard?strava=error", process.env.NEXTAUTH_URL!)
    );
  }

  const data = await res.json();

  await Promise.all([
    kv.set("strava:access_token", data.access_token),
    kv.set("strava:refresh_token", data.refresh_token),
    kv.set("strava:token_expires_at", data.expires_at),
  ]);

  return NextResponse.redirect(
    new URL("/dashboard?strava=connected", process.env.NEXTAUTH_URL!)
  );
}
