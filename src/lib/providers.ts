/* eslint-disable @typescript-eslint/no-explicit-any -- provider APIs return nested JSON with provider-specific, evolving schemas; normalize at each adapter boundary. */
import type { Domain, QueryIntent } from "./intent";
import type { Candidate } from "./ranking";

export class ProviderError extends Error { constructor(readonly provider: string, readonly status: number, message: string) { super(message); } }
const movieGenres: Record<string, number> = { action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36, horror: 27, music: 10402, mystery: 9648, romance: 10749, "science fiction": 878, "sci-fi": 878, thriller: 53, war: 10752, western: 37 };
const langCodes: Record<string, string> = { hindi: "hi", english: "en", tamil: "ta", telugu: "te", malayalam: "ml", kannada: "kn", marathi: "mr", bengali: "bn", punjabi: "pa", korean: "ko", japanese: "ja", french: "fr", spanish: "es", chinese: "zh" };
const titleKey=(value:string)=>value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}]+/gu," ").trim();
function tmdbURL(path: string, params: Record<string, string> = {}) {
  const key = process.env.TMDB_API_KEY, token = process.env.TMDB_ACCESS_TOKEN;
  if (!key && !token) throw new ProviderError("TMDB", 503, "TMDB_API_KEY is not configured.");
  const url = new URL(`https://api.themoviedb.org/3${path}`); Object.entries(params).forEach(([k,v]) => { if (v) url.searchParams.set(k,v); });
  // Prefer the v3 key when both credentials exist. Some outbound proxies strip Authorization headers.
  if (key) url.searchParams.set("api_key", key);
  return { url, headers: { accept: "application/json", ...(!key && token ? { Authorization: `Bearer ${token}` } : {}) } };
}
async function json(url: URL, headers?: HeadersInit, provider = "Catalog") { const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000), cache: "no-store" }); if (!res.ok) throw new ProviderError(provider,res.status,`${provider} returned ${res.status}`); return res.json(); }
const art = (p: unknown, size = "w500") => typeof p === "string" && p ? `https://image.tmdb.org/t/p/${size}${p}` : null;
function movieItem(x: Record<string, any>, media: "movie" | "tv", source: string): Candidate {
  const genres = Array.isArray(x.genres) ? x.genres.map((g: any) => g.name).filter(Boolean) : Array.isArray(x.genre_ids) ? x.genre_ids.map((id: number) => Object.entries(movieGenres).find(([,v]) => v===id)?.[0]).filter(Boolean) : [];
  const keywords = Array.isArray(x.keywords?.keywords) ? x.keywords.keywords.map((k: any) => k.name) : Array.isArray(x.keywords?.results) ? x.keywords.results.map((k: any) => k.name) : [];
  const cast = (x.credits?.cast ?? []).slice(0,6).map((p: any) => p.name);
  const crew = (x.credits?.crew ?? []).filter((p: any) => ["Director","Writer","Screenplay"].includes(p.job)).slice(0,4).map((p: any) => `${p.name} (${p.job})`);
  const trailer = (x.videos?.results ?? []).find((v: any) => v.site === "YouTube" && v.type === "Trailer" && v.official)?.key;
  const release = x.release_date ?? x.first_air_date ?? "";
  return { id:x.id, domain:media, type:media, provider:"tmdb", title:String(x.title ?? x.name ?? "Untitled"), year:String(release).slice(0,4), description:String(x.overview ?? ""), image:art(x.poster_path), backdrop:art(x.backdrop_path,"w1280"), rating:typeof x.vote_average === "number" && x.vote_average>0 ? x.vote_average : null,
    url:`https://www.themoviedb.org/${media}/${x.id}`, genres, keywords, people:[...cast,...crew].slice(0,10), language:String(x.original_language ?? ""), country:String(x.origin_country?.[0] ?? x.production_countries?.[0]?.iso_3166_1 ?? ""), runtime:typeof x.runtime === "number" ? x.runtime : typeof x.episode_run_time?.[0] === "number" ? x.episode_run_time[0] : null,
    details:[...genres,...keywords.slice(0,3),...crew], sources:[source], provider_data:{ provider_id:String(x.id), imdb_id:x.imdb_id ?? null, trailer:trailer ? `https://www.youtube.com/watch?v=${trailer}` : null, cast, crew, keywords, backdrop:art(x.backdrop_path,"w1280"), logo:art(x.images?.logos?.[0]?.file_path,"w500"), runtime:x.runtime ?? x.episode_run_time?.[0] ?? null, original_language:x.original_language, origin_country:x.origin_country ?? [], production_countries:x.production_countries ?? [], production_companies:(x.production_companies ?? []).map((c: any)=>c.name), tmdb_url:`https://www.themoviedb.org/${media}/${x.id}` } };
}
async function tmdbList(path: string, params: Record<string,string|number|string[]>, media: "movie"|"tv", source: string): Promise<Candidate[]> { const normalized=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,Array.isArray(v)?v.join("|"):String(v)]));const {url,headers}=tmdbURL(path,normalized); const data=await json(url,headers,"TMDB"); return (data.results??[]).map((x:Record<string,any>)=>movieItem({...x,media_type:media},media,source)); }
async function keywordIds(concepts: string[]) { const ids:string[]=[]; for (const term of concepts.slice(0,4)) { const {url,headers}=tmdbURL("/search/keyword",{query:term}); const data=await json(url,headers,"TMDB"); if (data.results?.[0]?.id) ids.push(String(data.results[0].id)); } return [...new Set(ids)]; }
function movieFilters(intent: QueryIntent, query: string) {
  const isTv=/\b(tv|series|shows?)\b/i.test(query)||intent.entity_type==="tv";
  const params:Record<string,string|number|string[]>={language:"en-US",include_adult:"false",sort_by:intent.novelty>.65?"vote_average.desc":"popularity.desc","vote_count.gte":"25"};
  const ids=intent.genres.map(g=>movieGenres[g.toLowerCase()]).filter(Boolean); if (ids.length) params.with_genres=ids.join("|");
  const lang=langCodes[(intent.language??"").toLowerCase()] ?? intent.language?.toLowerCase(); if (lang && /^[a-z]{2}$/.test(lang)) params.with_original_language=lang;
  const country=intent.country?.toLowerCase(); if (country) params.with_origin_country=({india:"IN","south korea":"KR","united states":"US",japan:"JP",france:"FR"} as Record<string,string>)[country] ?? intent.country!;
  // Industry heuristics intentionally use origin-country, language and region together; English alone never implies Hollywood.
  if ((intent.industry??"").toLowerCase()==="bollywood") { params.with_origin_country="IN"; params.with_original_language="hi"; params.region="IN"; }
  else if ((intent.industry??"").toLowerCase()==="south indian") { params.with_origin_country="IN"; if (!params.with_original_language) params.with_original_language="ta|te|ml|kn"; params.region="IN"; }
  else if ((intent.industry??"").toLowerCase()==="hollywood") { params.with_origin_country="US"; params.with_original_language="en"; params.region="US"; }
  else if ((intent.industry??"").toLowerCase()==="international") { params.without_origin_country="US"; }
  if ((intent.country??"").toLowerCase()==="india"||intent.country==="IN") params.region="IN";
  if (intent.year_range.min) params[isTv?"first_air_date.gte":"primary_release_date.gte"]=`${intent.year_range.min}-01-01`;
  if (intent.year_range.max) params[isTv?"first_air_date.lte":"primary_release_date.lte"]=`${intent.year_range.max}-12-31`;
  if (intent.runtime.min) params["with_runtime.gte"]=String(intent.runtime.min); if (intent.runtime.max) params["with_runtime.lte"]=String(intent.runtime.max);
  if (intent.people[0]) params.with_people=intent.people.slice(0,3).join(",");
  if (isTv) params.__media="tv";
  return params;
}
export async function searchMovies(query: string, intent: QueryIntent): Promise<Candidate[]> {
  const p=movieFilters(intent,query); const media=(p.__media==="tv"?"tv":"movie") as "movie"|"tv"; delete p.__media;
  const sources:Candidate[][]=[];
  if (intent.intent==="ENTITY_LOOKUP" || intent.intent==="SEARCH") {
    sources.push(await tmdbList(`/search/${media}`,{query,include_adult:"false",language:"en-US",page:"1"},media,"query"));
  }
  if (intent.intent==="PEOPLE_SEARCH") {
    const personQuery=intent.people[0]??intent.seed_entities[0]??query; const {url,headers}=tmdbURL("/search/person",{query:personQuery,include_adult:"false",language:"en-US"}); const people=await json(url,headers,"TMDB");
    const person=people.results?.[0]; if (person) { const discovery=await tmdbList(`/discover/${media}`,{...p,with_people:String(person.id)},media,"people"); sources.push(discovery); if (!discovery.length) sources.push((people.results??[]).slice(0,5).map((x:Record<string,any>)=>({id:x.id,domain:"movie",type:"person",provider:"tmdb",title:x.name,description:x.known_for_department,image:art(x.profile_path),details:(x.known_for??[]).map((y:any)=>y.title??y.name),sources:["people"],provider_data:{provider_id:String(x.id)}}))); }
  }
  const seedName=intent.seed_entities[0]; let seed:Candidate|undefined;
  if (seedName && ["SIMILAR","FILTERED_SIMILAR","RECOMMEND"].includes(intent.intent)) {
    const lookup=await tmdbList(`/search/${media}`,{query:seedName,include_adult:"false",language:"en-US",page:"1"},media,"seed"); seed=lookup.find(candidate=>titleKey(candidate.title)===titleKey(seedName))??lookup[0];
    if (seed) {
      const [similar,recommendations,detailData]=await Promise.all([
        tmdbList(`/${media}/${seed.id}/similar`,{language:"en-US",page:"1"},media,"similar").catch(()=>[]),
        tmdbList(`/${media}/${seed.id}/recommendations`,{language:"en-US",page:"1"},media,"recommendations").catch(()=>[]),
        (async()=>{const {url,headers}=tmdbURL(`/${media}/${seed!.id}`,{language:"en-US",append_to_response:"keywords,credits,videos,images"});return json(url,headers,"TMDB");})().catch(()=>null),
      ]);
      if (detailData) seed=movieItem(detailData,media,"seed");
      const addSeedEvidence=(items:Candidate[])=>items.forEach(item=>{item.evidence={...(item.evidence??{}),seed_title:seed!.title,seed_genres:seed!.genres??[],seed_keywords:seed!.keywords??[],seed_people:seed!.people??[]};});
      addSeedEvidence(similar); addSeedEvidence(recommendations); sources.push(similar,recommendations);
      // A modifier generates metadata-backed discover queries in addition to seed similarity. It never relabels a film as dark.
      if (intent.genres.length || intent.keywords.length || intent.tone.length || intent.mood.length) {
        const discover:Record<string,string|number|string[]>={...p}; delete discover["primary_release_date.gte"]; delete discover["primary_release_date.lte"];
        if (seed?.genres?.length && !discover.with_genres && intent.intent==="FILTERED_SIMILAR") { const inherited=seed.genres.map(g=>movieGenres[g.toLowerCase()]).filter(Boolean); if(inherited.length) discover.with_genres=inherited.slice(0,2).map(String).join("|"); }
        const concepts=[...intent.semantic_concepts,...intent.keywords,...intent.tone,...intent.mood];
        if (concepts.length) { const ids=await keywordIds(concepts).catch(()=>[]); if(ids.length) discover.with_keywords=ids.slice(0,5).join("|"); }
        const discovered=await tmdbList(`/discover/${media}`,discover,media,"discover").catch(()=>[]); addSeedEvidence(discovered); sources.push(discovered);
      }
    }
  }
  const discoverIntent=intent.intent==="DISCOVER" || (intent.intent==="SEARCH" && (intent.genres.length>0 || Boolean(intent.industry)));
  if (discoverIntent || intent.intent==="FILTERED_SIMILAR") {
    if (intent.keywords.length || intent.semantic_concepts.length) { const ids=await keywordIds([...intent.keywords,...intent.semantic_concepts]).catch(()=>[]); if(ids.length) p.with_keywords=ids.slice(0,5).join("|"); }
    sources.push(await tmdbList(`/discover/${media}`,p,media,"discover"));
  }
  if (!sources.some(x=>x.length) && !["DISCOVER","PERSONALIZED"].includes(intent.intent)) sources.push(await tmdbList(`/search/${media}`,{query:query.replace(/\b(but|more|less)\b.*$/i,"").trim(),include_adult:"false",language:"en-US",page:"1"},media,"query"));
  const merged=new Map<string,Candidate>(); for (const list of sources) for (const item of list) { const key=`${item.domain}:${item.id}`; const old=merged.get(key); if(old) old.sources=[...new Set([...(old.sources??[]),...(item.sources??[])])]; else merged.set(key,item); }
  const candidates=[...merged.values()];
  // Enrich only a small, deduplicated candidate set to limit provider calls.
  const top=candidates.slice(0,8); const enriched=await Promise.all(top.map(async item=>{
    if (Array.isArray(item.provider_data?.keywords) && item.provider_data.keywords.length || !/^\d+$/.test(String(item.id))) return item;
    try { const {url,headers}=tmdbURL(`/${media}/${item.id}`,{language:"en-US",append_to_response:"keywords,credits,videos,images"}); const d=await json(url,headers,"TMDB"); return movieItem(d,media,item.sources?.[0]??"discover"); } catch { return item; }
  }));
  return enriched;
}

async function musicBrainzSearch(kind: string, term: string) {
  const url=new URL(`https://musicbrainz.org/ws/2/${kind}/`); url.searchParams.set("query",term); url.searchParams.set("fmt","json"); url.searchParams.set("limit","15"); if(kind==="artist") url.searchParams.set("inc","tags");
  const res=await json(url,{"User-Agent":"FindYourNiche/1.0 (on-demand catalog; contact: support@find-your-niche.local)",accept:"application/json"},"MusicBrainz"); return res;
}
let musicBrainzNext=0;
async function spaced<T>(fn:()=>Promise<T>):Promise<T>{const wait=Math.max(0,musicBrainzNext-Date.now()); if(wait) await new Promise(r=>setTimeout(r,wait)); musicBrainzNext=Date.now()+1100; return fn();}
export async function searchMusic(query:string,intent:QueryIntent):Promise<Candidate[]> {
  // Discovery queries search catalog tags and activity concepts rather than asking
  // MusicBrainz to resolve the entire natural-language sentence as an artist.
  const isAlbum=intent.entity_type==="album"||/\balbums?\b/i.test(query); const isEntity=intent.intent==="ENTITY_LOOKUP"||intent.intent==="SEARCH"||intent.intent==="PEOPLE_SEARCH"||intent.intent==="SIMILAR"||intent.intent==="FILTERED_SIMILAR";
  const term=intent.seed_entities[0]??(isEntity?query:[...intent.genres,...intent.themes,...intent.semantic_concepts].slice(0,5).join(" ")); const result:Candidate[]=[];
  const first=isEntity?await spaced(()=>musicBrainzSearch("artist",term)).catch(error=>{console.warn("MusicBrainz unavailable; attempting iTunes Search fallback.");return {artists:[],providerError:String(error)};}):{artists:[]};
  for(const a of (isAlbum?[]:(first.artists??[])).slice(0,12)){ const tags=(a.tags??[]).map((t:any)=>String(t.name)); result.push({id:a.id,domain:"music",type:"artist",provider:"musicbrainz",title:a.name,year:String(a["begin-area"]?.name??""),description:a.disambiguation??"",details:tags.slice(0,5),keywords:tags,image:null,url:`https://musicbrainz.org/artist/${a.id}`,sources:["musicbrainz"],provider_data:{provider_id:a.id,mbid:a.id,tags,country:a.country??null}}); }
  const seed=(first.artists??[]).find((a:any)=>String(a.name??"").toLowerCase()===term.toLowerCase())??first.artists?.[0];
  if(seed&&["SIMILAR","FILTERED_SIMILAR","RECOMMEND"].includes(intent.intent)) {
    try { const relUrl=new URL(`https://musicbrainz.org/ws/2/artist/${seed.id}`); relUrl.searchParams.set("fmt","json"); relUrl.searchParams.set("inc","artist-rels+tags"); const rel=await spaced(()=>json(relUrl,{"User-Agent":"FindYourNiche/1.0 (on-demand catalog)",accept:"application/json"},"MusicBrainz"));
      for(const link of (rel.relations??[]).filter((r:any)=>r.artist?.id).slice(0,10)) { const a=link.artist; if(String(a.id)===String(seed.id))continue; result.push({id:a.id,domain:"music",type:"artist",provider:"musicbrainz",title:String(a.name??"Unknown artist"),description:String(link.type??"MusicBrainz artist relationship"),keywords:[],details:[String(link.type??"Related artist")],image:null,sources:["musicbrainz-relationship"],provider_data:{provider_id:a.id,mbid:a.id,relation:String(link.type??"")}}); }
    } catch { /* The catalog and iTunes remain useful when relationship lookup is missing. */ }
  }
  const headers={"User-Agent":"FindYourNiche/1.0 (on-demand catalog)",accept:"application/json"};
  const country=(intent.language||intent.country||intent.industry)?"IN":"US";
  const trackTerm=isEntity?term:[...intent.genres,...intent.themes,...intent.semantic_concepts].filter(Boolean).slice(0,7).join(" ")||query;
  try { const url=new URL("https://itunes.apple.com/search"); url.searchParams.set("term",trackTerm); url.searchParams.set("country",country); url.searchParams.set("media","music"); url.searchParams.set("entity",isAlbum?"album":"song"); url.searchParams.set("limit","18"); const data=await json(url,headers,"Apple Music Search");
    for(const t of data.results??[]){ const artUrl=String(t.artworkUrl100??"").replace(/100x100bb/,"600x600bb"); if(isAlbum){result.push({id:`itunes:album:${t.collectionId}`,domain:"music",type:"album",provider:"itunes",title:String(t.collectionName??"Untitled album"),description:String(t.artistName??""),image:artUrl||null,year:t.releaseDate?String(t.releaseDate).slice(0,4):"",genres:t.primaryGenreName?[String(t.primaryGenreName)]:[],details:[...(typeof t.trackCount==="number"?[`${t.trackCount} tracks`]:[]),String(t.primaryGenreName??"")].filter(Boolean),url:t.collectionViewUrl,sources:["itunes"],provider_data:{provider_id:String(t.collectionId),artist:t.artistName,album:t.collectionName,track_count:t.trackCount??null,genre:t.primaryGenreName??null,store_url:t.collectionViewUrl,country}});continue;} result.push({id:`itunes:${t.trackId}`,domain:"music",type:"track",provider:"itunes",title:String(t.trackName??t.collectionName??"Untitled"),description:String(t.artistName??""),image:artUrl||null,year:t.releaseDate?String(t.releaseDate).slice(0,4):"",genres:t.primaryGenreName?[String(t.primaryGenreName)]:[],details:[String(t.collectionName??""),...(typeof t.trackTimeMillis==="number"?[`${Math.round(t.trackTimeMillis/60000)} min`]:[])].filter(Boolean),url:t.trackViewUrl,sources:["itunes"],provider_data:{provider_id:String(t.trackId),artist:t.artistName,album:t.collectionName,preview_url:t.previewUrl??null,store_url:t.trackViewUrl,genre:t.primaryGenreName??null,duration_ms:t.trackTimeMillis??null,country}}); }
  } catch(error){ if(!result.length) throw error; console.warn("iTunes lookup failed; MusicBrainz results remain available."); }
  if(!result.some(item=>item.type==="track")){ for(const kind of ["release-group","recording"]){ const data=await spaced(()=>musicBrainzSearch(kind,term)); const entries=data[kind==="release-group"?"release-groups":"recordings"]??[]; for(const r of entries.slice(0,14)) result.push({id:r.id,domain:"music",type:kind,provider:"musicbrainz",title:r.title,description:"",year:String(r["first-release-date"]??"").slice(0,4),image:kind==="release-group"?`https://coverartarchive.org/release-group/${r.id}/front-500`:null,details:[String(r["primary-type"]??"")].filter(Boolean),sources:["musicbrainz"],provider_data:{provider_id:r.id}}); if(result.length) break; } }
  return result.slice(0,60);
}

async function searchBooksDirect(query:string,intent:QueryIntent):Promise<Candidate[]> { const url=new URL("https://openlibrary.org/search.json"); const base=intent.seed_entities[0]??query.replace(/^(?:find|search(?: for)?|show me|recommend(?: me)?)\s+/i,"").replace(/^(?:some\s+)?books?\s+(?:about|on|by|like|similar to)?\s*/i,"").replace(/\s+but\s+.*$/i,"").trim(); const range=intent.year_range.min||intent.year_range.max; const q=range?`${base} first_publish_year:[${intent.year_range.min??1870} TO ${intent.year_range.max??new Date().getFullYear()}]`:base; url.searchParams.set("q",q); if(intent.genres[0]||intent.themes[0])url.searchParams.set("subject",intent.genres[0]??intent.themes[0]); if(intent.language)url.searchParams.set("language",intent.language==="en"?"eng":intent.language); url.searchParams.set("limit","20"); url.searchParams.set("fields","key,title,author_name,first_publish_year,cover_i,subject,edition_count,number_of_pages_median,ratings_average,first_sentence,language"); const data=await json(url,{"User-Agent":"FindYourNiche/1.0 (on-demand catalog; contact: support@find-your-niche.local)"},"Open Library"); return (data.docs??[]).map((b:any)=>({id:b.key,domain:"book",type:"book",provider:"openlibrary",title:b.title,year:b.first_publish_year,description:(b.author_name??[]).join(", "),image:b.cover_i?`https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg`:null,rating:typeof b.ratings_average==="number"?b.ratings_average:null,genres:(b.subject??[]).slice(0,5),people:(b.author_name??[]).slice(0,8),details:[...(b.subject??[]).slice(0,3),...(b.number_of_pages_median?[`${b.number_of_pages_median} pages`]:[])],language:b.language?.[0],url:`https://openlibrary.org${b.key}`,sources:["openlibrary"],provider_data:{provider_id:b.key,subjects:b.subject??[],authors:b.author_name??[],edition_count:b.edition_count??0}})); }
async function searchBooks(query:string,intent:QueryIntent):Promise<Candidate[]> {
  const direct=await searchBooksDirect(query,intent);
  if(!["SIMILAR","FILTERED_SIMILAR","RECOMMEND"].includes(intent.intent)||!direct.length)return direct;
  const seedName=intent.seed_entities[0]??query;
  const seed=direct.find(item=>titleKey(item.title)===titleKey(seedName))??direct[0];
  const subjects=(seed.genres??[]).filter(x=>x.length>3&&!/fiction|general|literature|book|collection/i.test(x)).slice(0,3);
  if(!subjects.length)return direct;
  const related=await Promise.all(subjects.map(async subject=>searchBooksDirect(subject,{...intent,intent:"DISCOVER",seed_entities:[],genres:[subject],themes:[],keywords:[subject],semantic_concepts:[subject]}).catch(()=>[])));
  const byId=new Map<string,Candidate>();
  for(const item of related.flat())if(String(item.id)!==String(seed.id)){item.sources=[...(item.sources??[]),"shared-subject"];item.evidence={...(item.evidence??{}),seed_genres:subjects};byId.set(String(item.id),item);}
  for(const item of direct)if(String(item.id)!==String(seed.id)&&!byId.has(String(item.id)))byId.set(String(item.id),item);
  return byId.size?[...byId.values()].slice(0,30):direct;
}
async function searchCode(query:string,intent:QueryIntent):Promise<Candidate[]> { const headers:HeadersInit={accept:"application/vnd.github+json"}; if(process.env.GITHUB_TOKEN) headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`; const url=new URL("https://api.github.com/search/repositories"); let term=query.replace(/^(?:find|search(?: for)?|show me)\s+/i,"").replace(/\b(?:github|repositories|repos|projects)\b/gi,"").trim(); if(intent.experience_level)term+=` ${intent.experience_level}`; if(intent.language&&/^[a-z0-9+#.-]{1,24}$/i.test(intent.language))term+=` language:${intent.language}`; if(intent.genres[0]&&/^[a-z0-9-]{1,40}$/i.test(intent.genres[0]))term+=` topic:${intent.genres[0].toLowerCase()}`; url.searchParams.set("q",term||query); url.searchParams.set("sort","stars"); url.searchParams.set("per_page","20"); const data=await json(url,headers,"GitHub"); return (data.items??[]).map((r:any)=>({id:r.full_name,domain:"code",type:"repository",provider:"github",title:r.full_name,year:r.language??"",description:r.description??"",image:r.owner?.avatar_url??null,rating:r.stargazers_count,url:r.html_url,genres:r.topics??[],keywords:r.topics??[],details:[...(r.topics??[]).slice(0,4),...(r.language?[r.language]:[])],sources:["github"],provider_data:{provider_id:r.full_name,topics:r.topics??[],language:r.language,stars:r.stargazers_count,forks:r.forks_count}})); }
export async function searchExternal(query:string, domain:Domain, intent:QueryIntent):Promise<Candidate[]> { if(domain==="movie") return searchMovies(query,intent); if(domain==="book") return searchBooks(query,intent); if(domain==="music") return searchMusic(query,intent); return searchCode(query,intent); }
