import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, getSessionId } from "@/lib/db";

export async function POST(req: NextRequest) {
  const userId = getSessionId(req); const p = db();
  if (!userId || !p) return NextResponse.json({ error: "Comparison links need a configured database and active session." }, { status: 503 });
  try {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await p.query("UPDATE comparison_shares SET revoked_at=now(),status='revoked' WHERE owner_user_id=$1 AND revoked_at IS NULL AND expires_at>now()", [userId]);
    await p.query("INSERT INTO comparison_shares(owner_user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')", [userId, tokenHash]);
    const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
    const origin = configuredOrigin || req.nextUrl.origin;
    const localOnly = !configuredOrigin && /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(?::|$)/i.test(origin);
    return NextResponse.json({ url: new URL(`/compare/${token}`, origin).toString(), expiresInDays: 30, localOnly });
  } catch (error) { console.error("Comparison link creation failed:", error instanceof Error ? error.message : "unknown"); return NextResponse.json({ error: "Apply database migration 002_identity_compare.sql, then try again." }, { status: 503 }); }
}

export async function DELETE(req: NextRequest) {
  const userId = getSessionId(req); const p = db();
  if (!userId || !p) return NextResponse.json({ error: "Revoking comparison links needs an active session and database." }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (typeof body?.token !== "string" || body.token.length < 32 || body.token.length > 128) return NextResponse.json({ error: "Invalid comparison token." }, { status: 400 });
  const hash = createHash("sha256").update(body.token).digest("hex");
  const result = await p.query("UPDATE comparison_shares SET revoked_at=now(),status='revoked' WHERE owner_user_id=$1 AND token_hash=$2 AND revoked_at IS NULL RETURNING id", [userId, hash]);
  return result.rowCount ? NextResponse.json({ revoked: true }) : NextResponse.json({ error: "That active link was not found." }, { status: 404 });
}
