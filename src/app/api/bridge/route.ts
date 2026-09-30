import { NextRequest,NextResponse } from "next/server";
import { db,getSessionId } from "@/lib/db";
import type { Candidate } from "@/lib/ranking";
export async function GET(req:NextRequest){const userId=getSessionId(req);const p=db();if(!userId||!p)return NextResponse.json({enabled:false,concepts:[],results:[]});
try{
 const concepts=await p.query<{name:string;weight:number}>("SELECT name,weight FROM taste_nodes WHERE user_id=$1 AND node_type='concept' AND weight>0.05 ORDER BY weight DESC LIMIT 12",[userId]);
 if(!concepts.rows.length)return NextResponse.json({enabled:true,concepts:[],results:[],message:"Save or like a few discoveries to build your first bridge."});
 const names=concepts.rows.map(x=>x.name);
 const results=await p.query<{metadata:Candidate;matched:string[];seen:boolean}>(`SELECT e.metadata,array_agg(DISTINCT lower(signal)) FILTER(WHERE lower(signal)=ANY($2::text[])) AS matched,
   (own.entity_id IS NOT NULL) AS seen FROM entities e JOIN entity_metadata m ON m.entity_id=e.id
   CROSS JOIN LATERAL unnest(m.genres||m.keywords||m.people) AS signal
   LEFT JOIN user_entity_states own ON own.user_id=$1 AND own.entity_id=e.id
   WHERE lower(signal)=ANY($2::text[]) GROUP BY e.id,own.entity_id ORDER BY cardinality(array_agg(DISTINCT lower(signal)) FILTER(WHERE lower(signal)=ANY($2::text[]))) DESC,e.updated_at DESC LIMIT 100`,[userId,names]);
 const ranked=(results.rows.filter(r=>!r.seen).map(r=>({...r.metadata,bridge_concepts:r.matched,bridge_score:r.matched.length,domain:String(r.metadata.domain??"unknown")}))).sort((a,b)=>b.bridge_score-a.bridge_score);
 const groups=new Map<string,typeof ranked>();for(const item of ranked){const list=groups.get(item.domain)??[];if(list.length<4)list.push(item);groups.set(item.domain,list);}
 const spread=[...groups.values()].flat().slice(0,16);
 return NextResponse.json({enabled:true,concepts:concepts.rows.map(x=>x.name),results:spread});
}catch(error){console.error("Taste bridge lookup failed:",error instanceof Error?error.message:"unknown");return NextResponse.json({enabled:false,concepts:[],results:[],message:"Taste bridge is temporarily unavailable."},{status:503});}}
