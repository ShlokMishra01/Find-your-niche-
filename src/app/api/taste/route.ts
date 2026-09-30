import { NextRequest, NextResponse } from "next/server";
import { db, getSessionId } from "@/lib/db";
import { nameNiches, profileNiches } from "@/lib/niche";
export async function GET(req: NextRequest) {
  const userId = getSessionId(req); const p = db(); if (!userId || !p) return NextResponse.json({ enabled: false, nodes: [], stats: {} });
  try {
    const [nodes, stats, domains] = await Promise.all([
      p.query("SELECT id,name,node_type,round(weight::numeric,3) AS weight FROM taste_nodes WHERE user_id=$1 AND abs(weight)>.05 ORDER BY weight DESC LIMIT 24", [userId]),
      p.query("SELECT event_type,count(*)::int AS count FROM interactions WHERE user_id=$1 GROUP BY event_type", [userId]),
      p.query("SELECT e.domain,count(DISTINCT i.entity_id)::int AS count FROM interactions i JOIN entities e ON e.id=i.entity_id WHERE i.user_id=$1 GROUP BY e.domain", [userId]),
    ]);
    const edges=await p.query("SELECT source_node_id AS source,target_node_id AS target,round(weight::numeric,3) AS weight,edge_type FROM taste_edges WHERE user_id=$1 ORDER BY abs(weight) DESC LIMIT 40",[userId]);
    const clusters=await nameNiches(await profileNiches(userId));
    for(const cluster of clusters){await p.query("UPDATE niches SET name=$1 WHERE slug=$2",[cluster.name,`taste-${userId}-${cluster.index}`]);}
    return NextResponse.json({ enabled: true, nodes: nodes.rows, edges:edges.rows, stats: Object.fromEntries(stats.rows.map(r => [r.event_type, r.count])), domains: domains.rows, clusters });
  } catch (error) { console.error("Taste profile unavailable:", error instanceof Error ? error.message : "unknown"); return NextResponse.json({ enabled: false, nodes: [], stats: {} }); }
}
