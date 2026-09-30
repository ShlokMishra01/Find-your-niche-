import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, ensureUser, getSessionId, sessionCookieName } from "@/lib/db";

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) return NextResponse.json({ enabled: false }, { status: 503 });
  try {
    const current = getSessionId(req); const id: string = current ?? crypto.randomUUID(); await ensureUser(id);
    const response = NextResponse.json({ enabled: true });
    if (!current) response.cookies.set(sessionCookieName(), createSessionToken(id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch (error) { console.error("Session setup failed:", error instanceof Error ? error.message : "unknown"); return NextResponse.json({ enabled: false, reason: "Persistent personalization is temporarily unavailable." }, { status: 503 }); }
}
