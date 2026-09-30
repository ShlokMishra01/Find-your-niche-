import { NextRequest, NextResponse } from "next/server";
import { db, getSessionId } from "@/lib/db";
import { profileNiches } from "@/lib/niche";

export async function GET(req: NextRequest) {
  const userId=getSessionId(req),pool=db();
  if(!userId||!pool)return NextResponse.json({enabled:false,reason:"A configured database and active session are required to load a personal field guide."});
  try{
    const [account,nodes,edges,stats,recent,clusters]=await Promise.all([
      pool.query<{display_name:string|null;avatar_url:string|null}>("SELECT display_name,avatar_url FROM auth_accounts WHERE user_id=$1 AND provider='google' LIMIT 1",[userId]),
      pool.query("SELECT id,name,node_type,round(weight::numeric,3) AS weight FROM taste_nodes WHERE user_id=$1 AND abs(weight)>.05 ORDER BY weight DESC LIMIT 24",[userId]),
      pool.query("SELECT source_node_id AS source,target_node_id AS target,round(weight::numeric,3) AS weight,edge_type FROM taste_edges WHERE user_id=$1 ORDER BY abs(weight) DESC LIMIT 40",[userId]),
      pool.query("SELECT event_type,count(*)::int AS count FROM interactions WHERE user_id=$1 GROUP BY event_type",[userId]),
      pool.query("SELECT e.metadata,s.saved,s.reaction,s.rating,s.updated_at FROM user_entity_states s JOIN entities e ON e.id=s.entity_id WHERE s.user_id=$1 AND (s.saved OR s.reaction IS NOT NULL OR s.view_count>0) ORDER BY s.updated_at DESC LIMIT 12",[userId]),
      profileNiches(userId),
    ]);
    return NextResponse.json({enabled:true,identity:account.rows[0]??null,nodes:nodes.rows,edges:edges.rows,stats:Object.fromEntries(stats.rows.map(r=>[r.event_type,r.count])),recent:recent.rows.map(r=>({...r.metadata,state:{saved:r.saved,reaction:r.reaction,rating:r.rating},updated_at:r.updated_at})),clusters});
  }catch(error){console.error("Profile data unavailable:",error instanceof Error?error.message:"unknown");return NextResponse.json({enabled:false,reason:"Your field guide is temporarily unavailable."},{status:503});}
}
