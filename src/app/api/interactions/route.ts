import { NextRequest, NextResponse } from "next/server";
import { db, getSessionId, persistInteraction } from "@/lib/db";
const events = new Set(["VIEW", "LIKE", "UNLIKE", "DISLIKE", "UNDISLIKE", "SAVE", "UNSAVE", "RATE", "SKIP", "COMPLETE"]);
const domains = new Set(["movie", "tv", "book", "music", "code"]);
export async function GET(req: NextRequest) {
  const userId=getSessionId(req); const p=db(); if(!userId||!p)return NextResponse.json({enabled:false,items:[]});
  try { const rows=await p.query<{provider:string;external_id:string;title:string;domain:string;saved:boolean;reaction:string|null;rating:number|null}>(`SELECT e.provider,e.external_id,e.title,e.domain,s.saved,s.reaction,s.rating FROM user_entity_states s JOIN entities e ON e.id=s.entity_id WHERE s.user_id=$1 AND (s.saved OR s.reaction IS NOT NULL OR s.view_count>0 OR s.skipped OR s.completed)`,[userId]); return NextResponse.json({enabled:true,items:rows.rows}); }
  catch(error){console.error("Interaction read failed:",error instanceof Error?error.message:"unknown");return NextResponse.json({enabled:false,items:[]});}
}
export async function POST(req: NextRequest) {
  const userId = getSessionId(req); if (!userId || !db()) return NextResponse.json({ error: "Persistent taste needs a configured database and signed session." }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (!body || !events.has(body.event) || !domains.has(body.domain) || typeof body.title !== "string" || body.title.length > 200 || typeof body.provider !== "string" || typeof body.externalId !== "string" || body.externalId.length > 120) return NextResponse.json({ error: "Invalid interaction." }, { status: 400 });
  if (body.event === "RATE" && (!Number.isInteger(body.value) || body.value < 1 || body.value > 5)) return NextResponse.json({ error: "Ratings must be from 1 to 5." }, { status: 400 });
  try { const state=await persistInteraction(userId, { ...body, type: String(body.type ?? "entity").slice(0, 50), description: typeof body.description === "string" ? body.description.slice(0, 1000) : "", metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {} }); return NextResponse.json({ saved: true,state }); }
  catch (error) { console.error("Interaction persistence failed:", error instanceof Error ? error.message : "unknown"); return NextResponse.json({ error: "Could not save this taste signal." }, { status: 503 }); }
}
