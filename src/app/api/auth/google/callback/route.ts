import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, db, getSessionId, sessionCookieName } from "@/lib/db";

type GoogleUser = { sub: string; name?: string; picture?: string; email?: string; email_verified?: boolean };

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const expected = req.cookies.get("fyn_oauth_state")?.value ?? "";
  const code = req.nextUrl.searchParams.get("code");
  const p = db();
  if (!state || !expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected)) || !code || !p) {
    return NextResponse.redirect(new URL("/login?auth=unavailable", req.nextUrl.origin));
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return NextResponse.redirect(new URL("/login?auth=unavailable", req.nextUrl.origin));
  try {
    const callback = new URL("/api/auth/google/callback", req.nextUrl.origin).toString();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callback, grant_type: "authorization_code" }), signal: AbortSignal.timeout(12_000) });
    if (!tokenResponse.ok) throw new Error("Google token exchange failed");
    const token = await tokenResponse.json();
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(12_000) });
    if (!profileResponse.ok) throw new Error("Google profile lookup failed");
    const profile = await profileResponse.json() as GoogleUser;
    if (!profile.sub) throw new Error("Google did not return a stable account identifier");
    const client = await p.connect();
    let userId: string; let createdAccount = false;
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ user_id: string }>("SELECT user_id FROM auth_accounts WHERE provider='google' AND provider_account_id=$1 FOR UPDATE", [profile.sub]);
      if (existing.rows[0]) userId = existing.rows[0].user_id;
      else {
        createdAccount = true;
        const anonymousId = getSessionId(req);
        if (anonymousId) {
          const exists = await client.query("SELECT id FROM users WHERE id=$1", [anonymousId]);
          if (exists.rows[0]) userId = anonymousId;
          else userId = (await client.query<{ id: string }>("INSERT INTO users DEFAULT VALUES RETURNING id")).rows[0].id;
        } else {
        userId = (await client.query<{ id: string }>("INSERT INTO users DEFAULT VALUES RETURNING id")).rows[0].id;
        }
      }
      await client.query(`INSERT INTO auth_accounts(provider,provider_account_id,user_id,display_name,avatar_url,email)
        VALUES('google',$1,$2,$3,$4,$5) ON CONFLICT(provider,provider_account_id) DO UPDATE SET display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url,email=EXCLUDED.email,updated_at=now()`, [profile.sub, userId, profile.name ?? null, profile.picture ?? null, profile.email_verified ? profile.email ?? null : null]);
      await client.query("INSERT INTO taste_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING", [userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    const response = NextResponse.redirect(new URL(`/?auth=success&flow=${createdAccount ? "created" : "welcome"}`, req.nextUrl.origin));
    response.cookies.set(sessionCookieName(), createSessionToken(userId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    response.cookies.delete("fyn_oauth_state");
    return response;
  } catch (error) {
    console.error("Google sign-in failed:", error instanceof Error ? error.message : "unknown");
    const response = NextResponse.redirect(new URL("/login?auth=error", req.nextUrl.origin));
    response.cookies.delete("fyn_oauth_state");
    return response;
  }
}
