import type { Candidate } from "./ranking";
import { db } from "./db";

export type TasteSample={id:string;domain:string;metadata:Candidate;embedding:number[]|null;weight:number};
export type TasteCluster={index:number;name:string;sample_count:number;signals:string[];domains:string[];centroid:number[]};
const stop=new Set(["the","and","with","about","this","that","from","into","your","their","movie","movies","book","books","music","artist","track","track","album","tv","show","series"]);
function terms(sample:TasteSample){return [...(sample.metadata.genres??[]),...(sample.metadata.keywords??[]),...(sample.metadata.people??[])].map(x=>x.toLowerCase().trim()).filter(x=>x.length>2&&!stop.has(x));}
function hashFeatures(sample:TasteSample,dims=128){const vector=Array.from({length:dims},()=>0);for(const term of [...terms(sample),...sample.metadata.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>2&&!stop.has(x))]){let h=2166136261;for(let i=0;i<term.length;i++)h=Math.imul(h^term.charCodeAt(i),16777619);const idx=(h>>>0)%dims;vector[idx]+=1;}return unit(vector);}
function unit(v:number[]){const n=Math.sqrt(v.reduce((s,x)=>s+x*x,0));return n?v.map(x=>x/n):v;}
function cosine(a:number[],b:number[]){if(a.length!==b.length)return 0;return a.reduce((s,x,i)=>s+x*b[i],0);}
function label(signals:string[]){return signals.slice(0,3).map(x=>x.replace(/\b\w/g,c=>c.toUpperCase())).join(" · ")||"Mixed explorations";}
export function clusterTaste(samples:TasteSample[]):TasteCluster[]{
  if(samples.length<2)return [];
  const usesEmbeddings=samples.length>=3&&samples.every(s=>s.embedding?.length===1536);
  const rows=samples.map(s=>({sample:s,vector:unit(usesEmbeddings?s.embedding!:hashFeatures(s))}));
  const k=Math.min(4,Math.max(1,Math.round(Math.sqrt(rows.length/2))));
  const centers=[rows.reduce((best,row)=>row.sample.weight>best.sample.weight?row:best,rows[0]).vector];
  while(centers.length<k){const farthest=rows.reduce((best,row)=>Math.max(...centers.map(c=>cosine(c,row.vector)))<Math.max(...centers.map(c=>cosine(c,best.vector)))?row:best,rows[0]);centers.push(farthest.vector);}
  let assignments=rows.map(()=>0);
  for(let iter=0;iter<25;iter++){const next:number[]=Array(rows.length).fill(0);
    for(let r=0;r<rows.length;r++){let best=0;for(let j=1;j<centers.length;j++)if(cosine(centers[j],rows[r].vector)>cosine(centers[best],rows[r].vector))best=j;next[r]=best;}
    if(next.every((x,i)=>x===assignments[i])&&iter>0)break;assignments=next;
    for(let j=0;j<centers.length;j++){const members=rows.filter((_,i)=>assignments[i]===j);if(members.length){const sum=centers[j].map((_,d)=>members.reduce((s,r)=>s+r.vector[d],0));centers[j]=unit(sum);}}
  }
  return centers.map((centroid,index)=>{const members=rows.filter((_,i)=>assignments[i]===index);const counts=new Map<string,number>(),domains=new Set<string>();for(const {sample} of members){domains.add(sample.domain);for(const term of terms(sample))counts.set(term,(counts.get(term)??0)+sample.weight);}
    const signals=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([s])=>s);return{index,name:label(signals),sample_count:members.length,signals,domains:[...domains],centroid};}).filter(c=>c.sample_count>0);
}

export async function profileNiches(userId:string){
  const p=db();if(!p)return[];
  const rows=await p.query<{id:string;domain:string;metadata:Candidate;embedding:string|null;weight:number}>(`SELECT e.id,e.domain,e.metadata,e.embedding::text AS embedding,
    ((CASE WHEN s.saved THEN .55 ELSE 0 END)+(CASE WHEN s.reaction='LIKE' THEN 1 ELSE 0 END)+GREATEST(0,coalesce(s.rating,3)-3)*.5)::real AS weight
    FROM user_entity_states s JOIN entities e ON e.id=s.entity_id WHERE s.user_id=$1 AND (s.saved OR s.reaction='LIKE' OR s.rating>=4)
    ORDER BY weight DESC,s.updated_at DESC,e.id ASC LIMIT 100`,[userId]);
  const parseVector=(s:string|null)=>s&&s.startsWith("[")?s.slice(1,-1).split(",").map(Number):null;
  const clusters=clusterTaste(rows.rows.map(r=>({id:r.id,domain:r.domain,metadata:r.metadata,embedding:parseVector(r.embedding),weight:Number(r.weight)})));
  for(const cluster of clusters){const slug=`taste-${userId}-${cluster.index}`;const pgVector=cluster.centroid.length===1536?`[${cluster.centroid.join(",")}]`:null;
    const result=await p.query<{id:string}>(`INSERT INTO niches(slug,name,description,centroid,metadata) VALUES($1,$2,$3,${pgVector?"$4::vector":"NULL"},$5::jsonb)
      ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,centroid=COALESCE(EXCLUDED.centroid,niches.centroid),metadata=EXCLUDED.metadata RETURNING id`,pgVector?[slug,cluster.name,`A deterministic ${pgVector?"embedding":"metadata-feature"} cluster of ${cluster.sample_count} saved, liked, or highly rated entities.`,pgVector,JSON.stringify({signals:cluster.signals,domains:cluster.domains,sample_count:cluster.sample_count,algorithm:pgVector?"kmeans-cosine-pgvector":"kmeans-cosine-metadata-v1"})]:[slug,cluster.name,`A deterministic metadata-feature cluster of ${cluster.sample_count} saved, liked, or highly rated entities.`,JSON.stringify({signals:cluster.signals,domains:cluster.domains,sample_count:cluster.sample_count,algorithm:"kmeans-cosine-metadata-v1"})]);
    await p.query("INSERT INTO user_niches(user_id,niche_id,score) VALUES($1,$2,$3) ON CONFLICT(user_id,niche_id) DO UPDATE SET score=EXCLUDED.score,updated_at=now()",[userId,result.rows[0].id,cluster.sample_count/Math.max(1,rows.rowCount??0)]);
  }
  return clusters;
}

export async function nameNiches(clusters:TasteCluster[]):Promise<TasteCluster[]>{
  const key=process.env.OPENROUTER_API_KEY;if(!key||!clusters.length)return clusters;
  try{const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENROUTER_REASONING_MODEL||"nvidia/nemotron-3-ultra-550b-a55b:free",temperature:0,max_tokens:250,response_format:{type:"json_object"},messages:[{role:"system",content:"For each cluster, give a concise human-readable label using only the exact supplied catalog signals. Never infer personality or add concepts. Return JSON {labels:[string]} in cluster order."},{role:"user",content:JSON.stringify(clusters.map(c=>({signals:c.signals,domains:c.domains,count:c.sample_count})))}]}),signal:AbortSignal.timeout(5_000)});if(!response.ok)return clusters;const content=(await response.json()).choices?.[0]?.message?.content;if(typeof content!=="string")return clusters;const labels=JSON.parse(content).labels;if(!Array.isArray(labels))return clusters;return clusters.map((c,i)=>{const candidate=typeof labels[i]==="string"?labels[i].trim().slice(0,70):"";const safe=candidate&&c.signals.some(s=>candidate.toLowerCase().includes(s.toLowerCase()))?candidate:c.name;return{...c,name:safe};});}catch{return clusters;}
}
