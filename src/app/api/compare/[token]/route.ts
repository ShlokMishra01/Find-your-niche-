import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, getSessionId } from "@/lib/db";

type SummaryRow = { name: string; node_type: string; weight: number };
async function tasteSummary(userId: string, pool: NonNullable<ReturnType<typeof db>>) {
  const result = await pool.query<SummaryRow>("SELECT name,node_type,round(weight::numeric,2)::float AS weight FROM taste_nodes WHERE user_id=$1 AND node_type IN ('concept','niche') AND weight>.05 ORDER BY weight DESC LIMIT 16", [userId]);
  return result.rows;
}

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params; const p = db();
  if (!p || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return NextResponse.json({ error: "This comparison link is unavailable." }, { status: 404 });
  const hash = createHash("sha256").update(token).digest("hex");
  try {
    const share = await p.query<{ owner_user_id: string; public_share_id: string; display_name: string | null }>("SELECT s.owner_user_id,u.public_share_id,a.display_name FROM comparison_shares s JOIN users u ON u.id=s.owner_user_id LEFT JOIN LATERAL (SELECT display_name FROM auth_accounts WHERE user_id=u.id ORDER BY updated_at DESC LIMIT 1) a ON true WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()", [hash]);
    if (!share.rows[0]) return NextResponse.json({ error: "This comparison link has expired or was revoked." }, { status: 404 });
    const ownerId = share.rows[0].owner_user_id;
    const viewerId = getSessionId(req);
    const owner = await tasteSummary(ownerId, p);
    const viewer = viewerId && viewerId !== ownerId ? await tasteSummary(viewerId, p) : [];
    const ownerConcepts = new Set(owner.filter(node => node.node_type === "concept").map(node => node.name.toLocaleLowerCase()));
    const viewerConcepts = new Set(viewer.filter(node => node.node_type === "concept").map(node => node.name.toLocaleLowerCase()));
    const shared = owner.filter(node => node.node_type === "concept" && viewerConcepts.has(node.name.toLocaleLowerCase())).map(node => node.name);
    const theirs = owner.filter(node => !viewerConcepts.has(node.name.toLocaleLowerCase()));
    const yours = viewer.filter(node => !ownerConcepts.has(node.name.toLocaleLowerCase()));
    return NextResponse.json({ valid: true, shared, theirs, yours, viewerAvailable: Boolean(viewerId) && viewer.length > 0, expiresInDays: 30, ownerIdentity: { displayName: share.rows[0].display_name || "A fellow explorer", tasteId: share.rows[0].public_share_id } });
  } catch (error) { console.error("Comparison lookup failed:", error instanceof Error ? error.message : "unknown"); return NextResponse.json({ error: "Comparison data is temporarily unavailable." }, { status: 503 }); }
}
