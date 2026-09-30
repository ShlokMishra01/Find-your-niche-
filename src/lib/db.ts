import { Pool } from "pg";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { Candidate } from "./ranking";

let pool: Pool | null = null;
export function db() { const url = process.env.DATABASE_URL; if (!url) return null; if (!pool) pool = new Pool({ connectionString: url, max: 6, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3_000, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" } }); return pool; }
const cookieName = "fyn_session";
function signature(id: string) { const secret = process.env.AUTH_SECRET; if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters."); return createHmac("sha256", secret).update(id).digest("hex"); }
export function createSessionToken(id: string = randomUUID()) { return `${id}.${signature(id)}`; }
export function sessionCookieName() { return cookieName; }
export function getSessionId(req: NextRequest) { const value = req.cookies.get(cookieName)?.value ?? ""; const [id, sig] = value.split("."); if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id)) return null; try { const expected = Buffer.from(signature(id)); const actual = Buffer.from(sig); return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null; } catch { return null; } }

export async function upsertCandidates(items: Candidate[], domain: string, embeddingMap: Map<string, number[]> = new Map()) {
  const p = db(); if (!p || !items.length) return;
  const client = await p.connect(); try { await client.query("BEGIN");
    for (const item of items) {
      const entityDomain = item.domain ?? domain;
      const baseProvider = String(item.provider ?? (entityDomain === "movie" || entityDomain === "tv" ? "tmdb" : entityDomain === "music" ? "musicbrainz" : entityDomain === "book" ? "openlibrary" : "github"));
      const provider = baseProvider === "tmdb" ? `tmdb:${entityDomain}` : baseProvider;
      const externalId = String(item.provider_data?.provider_id ?? item.id); const emb = embeddingMap.get(String(item.id));
      const metadata = item.provider_data ?? {};
      await client.query(`INSERT INTO entities(domain, entity_type, provider, external_id, title, description, metadata, embedding, embedding_model, embedding_version)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,${emb ? "$8::vector" : "NULL"},${emb ? "$9" : "NULL"},${emb ? "$10" : "NULL"})
        ON CONFLICT(provider, external_id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, metadata=EXCLUDED.metadata, updated_at=now(),
        embedding=COALESCE(EXCLUDED.embedding, entities.embedding), embedding_model=COALESCE(EXCLUDED.embedding_model, entities.embedding_model), embedding_version=COALESCE(EXCLUDED.embedding_version, entities.embedding_version)`,
        emb ? [entityDomain, item.type, provider, externalId, item.title, item.description ?? "", JSON.stringify(item), `[${emb.join(",")}]`, process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small", "1"] : [entityDomain, item.type, provider, externalId, item.title, item.description ?? "", JSON.stringify(item)]);
      const id = (await client.query<{ id: string }>("SELECT id FROM entities WHERE provider=$1 AND external_id=$2", [provider, externalId])).rows[0]?.id;
      if (id) {
        await client.query(`INSERT INTO entity_metadata(entity_id,genres,keywords,people,language,country,industry,release_year,runtime,provider_data)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(entity_id) DO UPDATE SET genres=EXCLUDED.genres,keywords=EXCLUDED.keywords,people=EXCLUDED.people,language=EXCLUDED.language,country=EXCLUDED.country,industry=EXCLUDED.industry,release_year=EXCLUDED.release_year,runtime=EXCLUDED.runtime,provider_data=EXCLUDED.provider_data`,
          [id, item.genres ?? [], item.keywords ?? [], item.people ?? [], item.language ?? null, item.country ?? null, item.provider_data?.industry ?? null, Number(item.year) || null, item.runtime ?? null, JSON.stringify(metadata)]);
        const signals=[...(item.genres??[]).map(name=>({name,rel:"HAS_GENRE"})),...(item.keywords??[]).map(name=>({name,rel:"HAS_KEYWORD"})),...(item.people??[]).map(name=>({name,rel:"FEATURES_PERSON"}))].filter(x=>x.name.trim()).slice(0,32);
        for(const signal of signals){
          const slug=signal.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,90); if(!slug)continue;
          const conceptProvider=`catalog-concept:${entityDomain}`; const conceptExternal=`${signal.rel.toLowerCase()}:${slug}`;
          const concept=(await client.query<{id:string}>("INSERT INTO entities(domain,entity_type,provider,external_id,title,description,metadata) VALUES($1,'concept',$2,$3,$4,'',jsonb_build_object('kind',$5)) ON CONFLICT(provider,external_id) DO UPDATE SET title=EXCLUDED.title RETURNING id",[entityDomain,conceptProvider,conceptExternal,signal.name,signal.rel])).rows[0].id;
          await client.query("INSERT INTO entity_relationships(source_entity_id,target_entity_id,relationship,provider,confidence) VALUES($1,$2,$3,$4,1) ON CONFLICT(source_entity_id,target_entity_id,relationship) DO UPDATE SET provider=EXCLUDED.provider",[id,concept,signal.rel,provider]);
        }
        if (emb) await client.query("INSERT INTO embeddings(entity_id,model,version,embedding,source_hash) VALUES($1,$2,'1',$3::vector,encode(digest($4,'sha256'),'hex')) ON CONFLICT(entity_id,model,version) DO UPDATE SET embedding=EXCLUDED.embedding,source_hash=EXCLUDED.source_hash,updated_at=now()", [id, process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small", `[${emb.join(",")}]`, `${item.title} ${item.description ?? ""}`]);
      }
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function retrieveLocal(query: string, domain: string, vector?: number[], userId?: string) {
  const p = db(); if (!p) return { candidates: [] as Candidate[], taste: [] as string[], avoid: [] as string[], seen: new Set<string>() };
  const vectorLit = vector?.length ? `[${vector.join(",")}]` : null;
  const result = await p.query<{ metadata: Candidate; similarity: number }>(`SELECT metadata,
    CASE WHEN $3::vector IS NOT NULL AND embedding IS NOT NULL THEN 1-(embedding <=> $3::vector) ELSE 0 END AS similarity
    FROM entities WHERE domain=$1 AND (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(metadata::text,'')) @@ plainto_tsquery('simple',$2)
      OR ($3::vector IS NOT NULL AND embedding IS NOT NULL))
    ORDER BY CASE WHEN $3::vector IS NOT NULL AND embedding IS NOT NULL THEN embedding <=> $3::vector ELSE 0 END, updated_at DESC LIMIT 80`, [domain, query, vectorLit]);
  const tasteRows = userId ? await p.query<{ name: string; weight: number }>("SELECT name,weight FROM taste_nodes WHERE user_id=$1 AND node_type='concept' AND abs(weight)>.05 ORDER BY weight DESC LIMIT 48", [userId]) : { rows: [] };
  const taste = tasteRows.rows.filter(r=>Number(r.weight)>0).slice(0,24).map(r=>r.name); const avoid = tasteRows.rows.filter(r=>Number(r.weight)<0).map(r=>r.name);
  if(userId&&taste.length){ const related=await p.query<{metadata:Candidate}>(`SELECT DISTINCT e.metadata FROM entities e JOIN entity_metadata m ON m.entity_id=e.id WHERE e.domain=$1 AND (
    EXISTS(SELECT 1 FROM unnest(m.genres || m.keywords || m.people) t WHERE lower(t)=ANY($2::text[]))) ORDER BY e.updated_at DESC LIMIT 60`,[domain,taste]); result.rows.push(...related.rows.map(r=>({metadata:r.metadata,similarity:0}))); }
  const graph=await p.query<{metadata:Candidate}>(`SELECT DISTINCT e.metadata FROM entity_relationships r JOIN entities concept ON concept.id=r.target_entity_id JOIN entity_relationships neighbor ON neighbor.target_entity_id=concept.id AND neighbor.source_entity_id<>r.source_entity_id JOIN entities e ON e.id=neighbor.source_entity_id WHERE e.domain=$1 AND (to_tsvector('simple',concept.title) @@ plainto_tsquery('simple',$2) OR to_tsvector('simple',e.title||' '||e.description) @@ plainto_tsquery('simple',$2)) ORDER BY e.updated_at DESC LIMIT 40`,[domain,query]); result.rows.push(...graph.rows.map(r=>({metadata:r.metadata,similarity:0})));
  if(userId){const crowd=await p.query<{metadata:Candidate;collaborative_score:number}>(`WITH mine AS (SELECT entity_id FROM user_entity_states WHERE user_id=$1 AND (saved OR reaction='LIKE'))
    SELECT e.metadata,count(DISTINCT i.user_id)::real AS collaborative_score FROM mine m JOIN interactions i ON i.entity_id=m.entity_id AND i.user_id<>$1 AND i.weight>0
    JOIN user_entity_states s ON s.user_id=i.user_id AND s.entity_id=i.entity_id AND (s.saved OR s.reaction='LIKE')
    JOIN entities e ON e.id=i.entity_id AND e.domain=$2 LEFT JOIN user_entity_states own ON own.user_id=$1 AND own.entity_id=e.id
    WHERE own.entity_id IS NULL GROUP BY e.id ORDER BY collaborative_score DESC LIMIT 40`,[userId,domain]);
    result.rows.push(...crowd.rows.map(r=>({metadata:{...r.metadata,evidence:{...(r.metadata.evidence??{}),collaborative_score:Number(r.collaborative_score)},sources:[...(r.metadata.sources??[]),"collaborative"]},similarity:0})));}
  const seen = new Set<string>();
  if (userId) { const rows = await p.query<{ provider: string; external_id: string; domain:string }>("SELECT e.provider,e.external_id,e.domain FROM interactions i JOIN entities e ON e.id=i.entity_id WHERE i.user_id=$1 AND i.event_type IN ('VIEW','LIKE','SAVE','RATE','DISLIKE','COMPLETE')", [userId]); rows.rows.forEach(r => seen.add(`${r.domain}:${r.provider.replace(/^tmdb:(movie|tv)$/,'tmdb')}:${r.external_id}`)); }
  return { candidates: result.rows.map(r => ({ ...r.metadata, evidence: { ...(r.metadata.evidence ?? {}), vector_similarity: Number(r.similarity) } })), taste, avoid, seen };
}

export async function persistInteraction(userId: string, input: { provider: string; externalId: string; domain: string; type: string; title: string; description?: string; event: string; value?: number; metadata?: Record<string, unknown> }) {
  const p = db(); if (!p) throw new Error("DATABASE_URL is not configured.");
  const client = await p.connect(); let resultState:{saved:boolean;reaction:string|null;rating:number|null}={saved:false,reaction:null,rating:null}; try { await client.query("BEGIN");
    const provider=input.provider==="tmdb"?`tmdb:${input.domain}`:input.provider;
    const entity = await client.query<{ id: string }>(`INSERT INTO entities(domain,entity_type,provider,external_id,title,description,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(provider,external_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,metadata=entities.metadata || EXCLUDED.metadata,updated_at=now() RETURNING id`, [input.domain, input.type, provider, input.externalId, input.title, input.description ?? "", JSON.stringify(input.metadata ?? {})]);
    const entityId=entity.rows[0].id; const prev=(await client.query<{saved:boolean;reaction:string|null;rating:number|null}>("SELECT saved,reaction,rating FROM user_entity_states WHERE user_id=$1 AND entity_id=$2",[userId,entityId])).rows[0]??{saved:false,reaction:null,rating:null};
    let saved=prev.saved,reaction=prev.reaction,rating=prev.rating;
    if(input.event==="SAVE")saved=true; if(input.event==="UNSAVE")saved=false;
    if(input.event==="LIKE")reaction="LIKE"; if(input.event==="UNLIKE"&&reaction==="LIKE")reaction=null;
    if(input.event==="DISLIKE")reaction="DISLIKE"; if(input.event==="UNDISLIKE"&&reaction==="DISLIKE")reaction=null;
    if(input.event==="RATE")rating=input.value??3;
    const tasteValue=(s:boolean,r:string|null,rate:number|null)=>(s?.55:0)+(r==="LIKE"?1:r==="DISLIKE"?-1:0)+(rate===null?0:(rate-3)/2);
    const delta=tasteValue(saved,reaction,rating)-tasteValue(prev.saved,prev.reaction,prev.rating); resultState={saved,reaction,rating};
    const behaviorWeight=input.event==="VIEW" ? .05 : input.event==="SKIP" ? -.35 : input.event==="COMPLETE" ? .2 : 0;
    const weight=delta+behaviorWeight;
    await client.query("INSERT INTO user_entity_states(user_id,entity_id,saved,reaction,rating,view_count,skipped,completed) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,entity_id) DO UPDATE SET saved=EXCLUDED.saved,reaction=EXCLUDED.reaction,rating=EXCLUDED.rating,view_count=user_entity_states.view_count+EXCLUDED.view_count,skipped=CASE WHEN $9='SKIP' THEN true WHEN $9 IN ('VIEW','LIKE','SAVE','RATE') THEN false ELSE user_entity_states.skipped END,completed=CASE WHEN $9='COMPLETE' THEN true ELSE user_entity_states.completed END,updated_at=now()",[userId,entityId,saved,reaction,rating,input.event==="VIEW"?1:0,input.event==="SKIP",input.event==="COMPLETE",input.event]);
    await client.query("INSERT INTO interactions(user_id,entity_id,event_type,weight,value) VALUES($1,$2,$3,$4,$5)", [userId, entityId, input.event, weight, input.value ?? null]);
    const entityNode = (await client.query<{ id: string }>("INSERT INTO taste_nodes(user_id,entity_id,name,node_type,weight) VALUES($1,$2,$3,'entity',$4) ON CONFLICT(user_id,name,node_type) DO UPDATE SET entity_id=EXCLUDED.entity_id,weight=taste_nodes.weight+EXCLUDED.weight,updated_at=now() RETURNING id", [userId, entityId, input.title.slice(0, 100), weight])).rows[0].id;
    const meta = input.metadata ?? {}; const tags = [...(Array.isArray(meta.genres) ? meta.genres : []), ...(Array.isArray(meta.keywords) ? meta.keywords : []), ...(Array.isArray(meta.people) ? meta.people : [])].filter((x): x is string => typeof x === "string").slice(0, 30);
    for (const tag of tags) { const concept = await client.query<{ id: string }>("INSERT INTO taste_nodes(user_id,name,node_type,weight) VALUES($1,$2,'concept',$3) ON CONFLICT(user_id,name,node_type) DO UPDATE SET weight=taste_nodes.weight+EXCLUDED.weight,updated_at=now() RETURNING id", [userId, tag.toLowerCase().slice(0, 100), weight * .2]); await client.query("INSERT INTO taste_edges(user_id,source_node_id,target_node_id,edge_type,weight) VALUES($1,$2,$3,'has_signal',$4) ON CONFLICT(user_id,source_node_id,target_node_id,edge_type) DO UPDATE SET weight=taste_edges.weight+EXCLUDED.weight,updated_at=now()", [userId, entityNode, concept.rows[0].id, weight * .1]); }
    await client.query("UPDATE taste_profiles SET version=version+1, updated_at=now() WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM recommendation_cache WHERE user_id=$1", [userId]); await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  return resultState;
}

export async function ensureUser(id: string) { const p = db(); if (!p) throw new Error("DATABASE_URL is not configured."); await p.query("INSERT INTO users(id) VALUES($1) ON CONFLICT(id) DO NOTHING", [id]); await p.query("INSERT INTO taste_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING", [id]); }

export async function getCatalogCache(key: string) { const p=db(); if(!p)return null; const r=await p.query<{payload:Candidate[]}>("SELECT payload FROM catalog_search_cache WHERE cache_key=$1 AND expires_at>now()",[key]); return r.rows[0]?.payload??null; }
export async function setCatalogCache(key:string,domain:string,payload:Candidate[],ttl:number) { const p=db(); if(!p)return; await p.query("INSERT INTO catalog_search_cache(cache_key,domain,payload,expires_at) VALUES($1,$2,$3::jsonb,now()+($4::text||' milliseconds')::interval) ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at,updated_at=now()",[key,domain,JSON.stringify(payload),ttl]); }
export async function getRecommendationCache(key:string,userId:string) { const p=db(); if(!p)return null; const r=await p.query<{payload:Candidate[]}>("SELECT payload FROM recommendation_cache WHERE cache_key=$1 AND user_id=$2 AND expires_at>now() AND taste_version=(SELECT version FROM taste_profiles WHERE user_id=$2)",[key,userId]); return r.rows[0]?.payload??null; }
export async function setRecommendationCache(key:string,userId:string,payload:Candidate[],ttl:number) { const p=db(); if(!p)return; await p.query("INSERT INTO recommendation_cache(cache_key,user_id,taste_version,payload,expires_at) VALUES($1,$2,COALESCE((SELECT version FROM taste_profiles WHERE user_id=$2),0),$3::jsonb,now()+($4::text||' milliseconds')::interval) ON CONFLICT(cache_key) DO UPDATE SET taste_version=EXCLUDED.taste_version,payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at",[key,userId,JSON.stringify(payload),ttl]); }

export async function embedding(text: string): Promise<number[] | null> {
  const key = process.env.OPENROUTER_API_KEY; const model = process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small"; if (!key) return null;
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: text.slice(0, 3000) }), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null; const data = await res.json(); const values = data.data?.[0]?.embedding; return Array.isArray(values) && values.length === 1536 && values.every((n: unknown) => typeof n === "number") ? values : null;
}

export async function embedMany(texts: string[]): Promise<number[][] | null> {
  const key = process.env.OPENROUTER_API_KEY; if (!key || !texts.length) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small", input: texts.map(x => x.slice(0, 3000)) }), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null; const data = await res.json(); const rows = Array.isArray(data.data) ? data.data : [];
    const embeddings = rows.map((r: { embedding?: unknown }) => r.embedding);
    return embeddings.length === texts.length && embeddings.every((v: unknown) => Array.isArray(v) && v.length === 1536 && v.every((n: unknown) => typeof n === "number")) ? embeddings as number[][] : null;
  } catch { return null; }
}
