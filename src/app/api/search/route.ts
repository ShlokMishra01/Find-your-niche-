import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseIntent, routeDomain, type Domain, type RequestedDomain } from "@/lib/intent";
import { rerank, type Candidate } from "@/lib/ranking";
import { db, embedMany, embedding, getCatalogCache, getRecommendationCache, getSessionId, retrieveLocal, setCatalogCache, setRecommendationCache, upsertCandidates } from "@/lib/db";
import { ProviderError, searchExternal } from "@/lib/providers";
import { getInspiration } from "@/lib/inspiration";

const domains = new Set<RequestedDomain>(["all", "movie", "book", "music", "code"]);
const providerCache = new Map<string,{expires:number;items:Candidate[]}>();
const providerTtl:Record<string,number>={movie:300_000,book:3_600_000,music:300_000,code:300_000};
function keyOf(item: Candidate) { return `${item.provider ?? item.domain}:${item.provider_data?.provider_id ?? item.id}`; }
function dedupe(items: Candidate[]) {
  const byId = new Map<string,Candidate>();
  for (const item of items) { const id=keyOf(item); const previous=byId.get(id); if(previous){previous.sources=[...new Set([...(previous.sources??[]),...(item.sources??[])])]; continue;} byId.set(id,item); }
  const values=[...byId.values()]; const seen=new Set<string>(); const output:Candidate[]=[];
  for(const item of values){ const artist=String(item.provider_data?.artist??item.description??"").toLowerCase().trim(); const title=item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim(); const exactKey=item.domain==="music"&&artist?`${title}|${artist}`:"";
    if(exactKey&&seen.has(exactKey)){const prior=output.find(x=>x.domain==="music"&&x.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()===title&&String(x.provider_data?.artist??x.description??"").toLowerCase().trim()===artist); if(prior){prior.sources=[...new Set([...(prior.sources??[]),...(item.sources??[])])]; if(!prior.image&&item.image)prior.image=item.image; if(item.provider_data?.preview_url)prior.provider_data={...prior.provider_data,preview_url:item.provider_data.preview_url};} continue;}
    if(exactKey)seen.add(exactKey); output.push(item);
  }
  return output;
}

export async function GET(req: NextRequest) {
  const query=req.nextUrl.searchParams.get("q")?.trim(); const requestedDomain=req.nextUrl.searchParams.get("domain") as RequestedDomain|null;
  if(!query||query.length>160)return NextResponse.json({error:"Enter a search of 1–160 characters."},{status:400});
  if(!requestedDomain||!domains.has(requestedDomain))return NextResponse.json({error:"Choose a valid discovery type."},{status:400});
  const domain:Domain=requestedDomain==="all"?routeDomain(query):requestedDomain;
  const requestId=createHash("sha256").update(`${domain}:${query.toLowerCase()}`).digest("hex").slice(0,14); const started=Date.now();
  const parsed=await parseIntent(query,domain); const intent=parsed.intent; const userId=getSessionId(req);
  const localTaste=[...new Set((req.nextUrl.searchParams.get("taste")??"").split("|").map(x=>x.trim().slice(0,60)).filter(x=>x.length>1))].slice(0,12);
  const localSeen=[...new Set((req.nextUrl.searchParams.get("seen")??"").split("|").map(x=>x.trim().slice(0,240)).filter(x=>x.length>2))].slice(0,40);
  const wantsLocalTaste=!userId&&localTaste.length>0&&(intent.intent==="PERSONALIZED"||/\b(what should i|recommend me|for me|things i like|my niche|something i(?:'ll| will) like)\b/i.test(query));
  if(wantsLocalTaste){intent.intent="DISCOVER";intent.semantic_concepts=[...new Set([...intent.semantic_concepts,...localTaste])];intent.keywords=[...new Set([...intent.keywords,...localTaste])];intent.selected_terms=[...new Set([...(intent.selected_terms??[]),...localTaste])];}
  const effectiveQuery=wantsLocalTaste?localTaste.join(" "):query;
  const genres=(req.nextUrl.searchParams.get("genre")??"").split(",").filter(Boolean).slice(0,4); const genreAllow=new Set(["action","adventure","animation","comedy","crime","documentary","drama","fantasy","history","horror","mystery","romance","science fiction","thriller","war","western","bollywood","classical","country","electronic","hip-hop","indie","jazz","k-pop","pop","rock","art","biography","philosophy","politics","psychology","science","strategy","ai","agents","fastapi","machine learning","rag"]);
  const selectedGenres=genres.map(x=>x.toLowerCase()).filter(x=>genreAllow.has(x)); if(selectedGenres.length)intent.genres=[...new Set([...intent.genres,...selectedGenres])];
  const selectedIndustry=req.nextUrl.searchParams.get("industry"); if(["Hollywood","Bollywood","South Indian","International"].includes(selectedIndustry??""))intent.industry=selectedIndustry;
  const selectedLanguage=req.nextUrl.searchParams.get("language"); if(selectedLanguage&&(domain==="code"?/^[a-z0-9+#.-]{1,24}$/i.test(selectedLanguage):/^[a-z]{2}$/.test(selectedLanguage)))intent.language=selectedLanguage;
  const selectedCountry=req.nextUrl.searchParams.get("country"); if(selectedCountry&&/^[A-Z]{2}$/.test(selectedCountry))intent.country=selectedCountry;
  const selectedExperience=req.nextUrl.searchParams.get("experience"); if(domain==="code"&&["beginner","intermediate","advanced"].includes(selectedExperience??"")){intent.experience_level=selectedExperience as "beginner"|"intermediate"|"advanced";intent.semantic_concepts=[...new Set([...intent.semantic_concepts,intent.experience_level])];intent.selected_terms=[...new Set([...(intent.selected_terms??[]),intent.experience_level])];}
  const minYear=Number(req.nextUrl.searchParams.get("yearFrom")); const maxYear=Number(req.nextUrl.searchParams.get("yearTo"));
  if(Number.isInteger(minYear)&&minYear>=1870&&minYear<=new Date().getFullYear()+1)intent.year_range.min=minYear;
  if(Number.isInteger(maxYear)&&maxYear>=1870&&maxYear<=new Date().getFullYear()+1)intent.year_range.max=maxYear;
  if(intent.year_range.min&&intent.year_range.max&&intent.year_range.min>intent.year_range.max)return NextResponse.json({error:"The start year must be before the end year."},{status:400});
  const runtimeMin=Number(req.nextUrl.searchParams.get("runtimeMin")),runtimeMax=Number(req.nextUrl.searchParams.get("runtimeMax"));
  if(Number.isInteger(runtimeMin)&&runtimeMin>=1&&runtimeMin<=600)intent.runtime.min=runtimeMin;
  if(Number.isInteger(runtimeMax)&&runtimeMax>=1&&runtimeMax<=600)intent.runtime.max=runtimeMax;
  if(intent.runtime.min&&intent.runtime.max&&intent.runtime.min>intent.runtime.max)return NextResponse.json({error:"The minimum runtime must be below the maximum runtime."},{status:400});
  const moodName=req.nextUrl.searchParams.get("mood")?.toLowerCase();const moodConcepts:Record<string,string[]>={dark:["dark","gritty","bleak","neo-noir","morally complex"],gritty:["gritty","realistic","crime"],psychological:["psychological","obsession","mind games"],intense:["intense","suspense","violence"],disturbing:["disturbing","bleak","psychological"],realistic:["realistic","grounded","social realism"],experimental:["experimental","avant-garde"],melancholic:["melancholic","emotional","slow"],romantic:["romantic","emotional"],dreamlike:["surreal","fantasy","dreamlike"]};
  if(moodName&&moodConcepts[moodName]){intent.mood=[...new Set([...intent.mood,moodName])];intent.semantic_concepts=[...new Set([...intent.semantic_concepts,...moodConcepts[moodName]])];intent.keywords=[...new Set([...intent.keywords,...moodConcepts[moodName]])];}
  const media=req.nextUrl.searchParams.get("media"); if(media==="tv"||media==="movie")intent.entity_type=media;
  if(selectedGenres.length||selectedIndustry||selectedLanguage||selectedCountry||minYear||maxYear||runtimeMin||runtimeMax||moodName){ if(!intent.seed_entities.length)intent.intent="DISCOVER"; else if(intent.intent==="SIMILAR")intent.intent="FILTERED_SIMILAR"; }
  const personalized=Boolean(userId&&db()); const recCacheKey=createHash("sha256").update(`rank:v2:${userId}:${domain}:${query.toLowerCase()}:${JSON.stringify(intent)}`).digest("hex");
  if(personalized&&["SIMILAR","FILTERED_SIMILAR","RECOMMEND","PERSONALIZED","DISCOVER"].includes(intent.intent)){ try{const cached=await getRecommendationCache(recCacheKey,userId!);if(cached)return NextResponse.json({results:cached,interpreted:{domain,intent:intent.intent,genres:intent.genres,language:intent.language,country:intent.country,mood:intent.mood,industry:intent.industry,selected_terms:intent.selected_terms??[],experience_level:intent.experience_level??null}});}catch{}}
  let local:Candidate[]=[]; let taste:string[]=[...localTaste]; let avoid:string[]=[]; let seen=new Set<string>(localSeen);
  if(db()) { try { const vector=await embedding(`${query}\n${intent.semantic_concepts.join(", ")}`); const data=await retrieveLocal(query,intent.entity_type==="tv"?"tv":domain,vector??undefined,userId??undefined); local=data.candidates; taste=[...new Set([...taste,...data.taste])]; avoid=data.avoid; seen=data.seen; } catch(error){ console.warn("Local retrieval is temporarily unavailable:",error instanceof Error?error.message:"unknown"); } }
  let external:Candidate[]=[]; let warning:string|undefined;
  const catalogKey=createHash("sha256").update(`catalog:v1:${domain}:${effectiveQuery.toLowerCase()}:${JSON.stringify(intent)}`).digest("hex");
  try {
    if(intent.intent!=="PERSONALIZED") {
      const mem=providerCache.get(catalogKey); const stored=mem&&mem.expires>Date.now()?mem.items:!mem?await getCatalogCache(catalogKey).catch(()=>null):null;
      if(stored){external=stored;providerCache.set(catalogKey,{expires:Date.now()+providerTtl[domain],items:stored});}
      else {external=await searchExternal(effectiveQuery,domain,intent);providerCache.set(catalogKey,{expires:Date.now()+providerTtl[domain],items:external});if(providerCache.size>300){const first=providerCache.keys().next().value;if(first)providerCache.delete(first);}await setCatalogCache(catalogKey,domain,external,providerTtl[domain]).catch(()=>{});}
    }
  }
  catch(error) {
    if(error instanceof ProviderError && error.status===429) warning="Search is busy right now. Please try again shortly.";
    else warning="Search is temporarily unavailable. Please try again shortly.";
    console.error("Provider search failure:",{requestId,domain,provider:error instanceof ProviderError?error.provider:"unknown",status:error instanceof ProviderError?error.status:0});
  }
  const candidates=dedupe([...external,...local]);
  if(userId&&db()) { try { await db()!.query("INSERT INTO search_history(user_id,query,domain,intent) VALUES($1,$2,$3,$4)",[userId,query,domain,intent.intent]); } catch { /* Search remains available if telemetry persistence is down. */ } }
  if(!candidates.length) {
    if(warning){
      const inspiration=getInspiration(effectiveQuery,[...intent.genres,...intent.themes,...intent.semantic_concepts,...(intent.selected_terms??[]),...localTaste],domain);
      if(inspiration.length){const results=rerank(query,intent,inspiration,taste,seen,avoid).slice(0,20);return NextResponse.json({results,warning:"The live catalog is taking a break. Here are curated starting points and related paths instead.",inspiration:true,interpreted:{domain,intent:intent.intent,genres:intent.genres,language:intent.language,country:intent.country,mood:intent.mood,industry:intent.industry,selected_terms:intent.selected_terms??[],experience_level:intent.experience_level??null},relatedSuggestions:["Try a neighboring genre","Explore this topic across books, film, and music","Follow a recommendation trail"]});}
      return NextResponse.json({error:"Live discovery is temporarily unavailable, and there are no curated results for this exact topic yet. Try a neighboring term or another catalog."},{status:502});
    }
    return NextResponse.json({results:[],interpreted:{domain,intent:intent.intent,genres:intent.genres,language:intent.language,mood:intent.mood,industry:intent.industry,selected_terms:intent.selected_terms??[],experience_level:intent.experience_level??null},message:"No matching results were found."});
  }
  const results=rerank(query,intent,candidates,taste,seen,avoid).slice(0,20);
  if(db()) { try { let vectors:number[][]|null=null; if(process.env.OPENROUTER_API_KEY)vectors=await embedMany(results.slice(0,16).map(r=>[r.title,r.description,...(r.genres??[]),...(r.keywords??[]),...(r.people??[])].join(". "))); const vectorMap=new Map<string,number[]>(); if(vectors)vectors.forEach((v,i)=>vectorMap.set(String(results[i].id),v)); await upsertCandidates(results,domain,vectorMap); } catch(error){ console.warn("Catalog cache/embedding update failed:",error instanceof Error?error.message:"unknown"); } }
  if(personalized&&["SIMILAR","FILTERED_SIMILAR","RECOMMEND","PERSONALIZED","DISCOVER"].includes(intent.intent)){ try{await setRecommendationCache(recCacheKey,userId!,results,120_000);}catch{}}
  const retrieval=[...new Set(results.flatMap(r=>r.sources??[]))]; const elapsed=Date.now()-started;
  console.info("Discovery retrieval:",{requestId,domain,intent:intent.intent,seed:intent.seed_entities[0]??null,sources:retrieval,candidates:candidates.length,results:results.length,latencyMs:elapsed,aiIntent:parsed.source==="openrouter"});
  return NextResponse.json({results,interpreted:{domain,intent:intent.intent,genres:intent.genres,language:intent.language,country:intent.country,mood:intent.mood,industry:intent.industry,selected_terms:intent.selected_terms??[],experience_level:intent.experience_level??null}});
}
