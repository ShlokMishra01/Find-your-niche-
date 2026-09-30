import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.AUTH_SECRET;
  if (!clientId || !secret || secret.length < 32) {
    return NextResponse.json({ error: "Google sign-in needs GOOGLE_CLIENT_ID and a valid AUTH_SECRET." }, { status: 503 });
  }
  const state = randomBytes(32).toString("base64url");
  const callback = new URL("/api/auth/google/callback", req.nextUrl.origin).toString();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", scope: "openid email profile", state, prompt: "select_account" }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set("fyn_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google/callback", maxAge: 600 });
  return response;
}
