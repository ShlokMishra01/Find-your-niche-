import test from "node:test";
import assert from "node:assert/strict";
import { deterministicIntent, routeDomain, validateIntent } from "../src/lib/intent";
import { rerank, type Candidate } from "../src/lib/ranking";
import { searchMovies } from "../src/lib/providers";
import { clusterTaste } from "../src/lib/niche";

test("modifier intent keeps the seed and turns darker into retrieval concepts",()=>{
  const i=deterministicIntent("movies like Scarface but darker","movie");
  assert.equal(i.intent,"FILTERED_SIMILAR"); assert.deepEqual(i.seed_entities,["scarface"]); assert.ok(i.keywords.includes("bleak")); assert.ok(i.keywords.includes("violence"));
});
test("Bollywood crime requests carry explicit language, country, industry, genre and era",()=>{
  const i=deterministicIntent("90s Bollywood crime movies","movie");
  assert.equal(i.industry,"Bollywood"); assert.equal(i.country,"India"); assert.equal(i.language,"hi"); assert.ok(i.genres.includes("crime")); assert.deepEqual(i.year_range,{min:1990,max:1999});
});
test("Hindi ambition query is a structured discovery and not a title-only lookup",()=>{
  const i=deterministicIntent("Hindi movies about ambition","movie");
  assert.equal(i.intent,"DISCOVER"); assert.equal(i.country,"India"); assert.equal(i.language,"hi"); assert.ok(i.themes.includes("ambition"));
});
test("person search extracts the person's name",()=>{
  const i=deterministicIntent("movies starring Al Pacino","movie");
  assert.equal(i.intent,"PEOPLE_SEARCH"); assert.deepEqual(i.people,["al pacino"]);
});
test("music similar intent extracts artist and sad modifier",()=>{
  const i=deterministicIntent("sad Hindi songs like Arijit Singh but sadder","music");
  assert.ok(["FILTERED_SIMILAR","SIMILAR"].includes(i.intent)); assert.deepEqual(i.seed_entities,["arijit singh"]); assert.equal(i.language,"hi"); assert.ok(i.semantic_concepts.includes("melancholic"));
});
test("intent schema rejects a domain mismatch and clamps model values",()=>{
  const bad=validateIntent({domain:"book",intent:"DISCOVER"},"movie"); assert.equal(bad,null);
  const good=validateIntent({domain:"movie",intent:"DISCOVER",novelty:4,genres:["crime"],year_range:{min:1800,max:2040}},"movie");
  assert.equal(good?.novelty,1); assert.equal(good?.year_range.min,null); assert.equal(good?.year_range.max,null);
});
test("universal routing selects a catalog from query meaning instead of defaulting to title search",()=>{
  assert.equal(routeDomain("RAG projects for beginners"),"code");
  assert.equal(routeDomain("books about power"),"book");
  assert.equal(routeDomain("sad Hindi songs"),"music");
  assert.equal(routeDomain("dark crime movies"),"movie");
});
test("technology suggestions and selections follow stated query intent",()=>{
  const broad=deterministicIntent("RAG projects","code");
  assert.equal(broad.domain,"code");assert.equal(broad.experience_level,null);assert.equal(broad.language,null);
  const beginner=deterministicIntent("RAG projects for beginners","code");assert.equal(beginner.experience_level,"beginner");
  const python=deterministicIntent("Python RAG projects","code");assert.equal(python.language,"Python");assert.ok(python.selected_terms?.includes("Python"));
});
test("universal routing honors the first explicit catalog phrase",()=>{
  assert.equal(routeDomain("movies connected to music"),"movie");
  assert.equal(routeDomain("music inspired by books"),"music");
});
test("mood/genre ranking prioritizes supported metadata signals",()=>{
  const i=deterministicIntent("movies like Scarface but darker","movie");
  const candidates:Candidate[]=[
    {id:1,domain:"movie",type:"movie",provider:"tmdb",title:"Bleak Crime Story",description:"A violent, gritty gangster drama about ambition and power.",genres:["Crime","Drama"],keywords:["gangster","violence","bleak"],sources:["similar"]},
    {id:2,domain:"movie",type:"movie",provider:"tmdb",title:"Bright Romance",description:"A light romantic comedy.",genres:["Romance","Comedy"],keywords:["romance","happy"],sources:["similar"]},
  ];
  const ranked=rerank("movies like Scarface but darker",i,candidates); assert.equal(ranked[0].id,1); assert.ok(Number(ranked[0].evidence?.mood_match)>0);
});
test("seen entities are penalized and excluded from the lead position",()=>{
  const i=deterministicIntent("crime movies","movie");
  const candidates:Candidate[]=[{id:1,domain:"movie",type:"movie",provider:"tmdb",title:"Crime classic",description:"crime",genres:["crime"]},{id:2,domain:"movie",type:"movie",provider:"tmdb",title:"A different crime film",description:"crime story",genres:["crime"]}];
  const ranked=rerank("crime movies",i,candidates,[],new Set(["movie:tmdb:1"])); assert.equal(ranked[0].id,2);
  const browserSaved=rerank("crime movies",i,candidates,[],new Set(["tmdb:movie:1"])); assert.equal(browserSaved[0].id,2);
});
test("movie adapter combines similar, recommendations, keyword and discover endpoints for a modifier",async()=>{
  const oldKey=process.env.TMDB_API_KEY,oldFetch=globalThis.fetch;process.env.TMDB_API_KEY="adapter-only-test-key";const paths:string[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{const url=new URL(String(input));paths.push(url.pathname);const p=url.pathname;let body:Record<string,unknown>={results:[]};
    if(p==="/3/search/movie")body={results:[{id:100,title:"Scarface",media_type:"movie",release_date:"1983-12-09",genre_ids:[80,18]}]};
    else if(p==="/3/movie/100/similar")body={results:[{id:101,title:"A Bleak Crime",media_type:"movie",genre_ids:[80]}]};
    else if(p==="/3/movie/100/recommendations")body={results:[{id:102,title:"Power and Violence",media_type:"movie",genre_ids:[80,18]}]};
    else if(p==="/3/search/keyword")body={results:[{id:500,name:"bleak"}]};
    else if(p==="/3/discover/movie")body={results:[{id:103,title:"Gritty Thriller",media_type:"movie",genre_ids:[53,80]}]};
    else if(/^\/3\/movie\/\d+$/.test(p)){const id=Number(p.split("/").pop());body={id,title:id===100?"Scarface":`Candidate ${id}`,overview:id===101?"A bleak, gritty crime story.":"A story about power.",genres:[{id:80,name:"Crime"},{id:18,name:"Drama"}],keywords:{keywords:[{id:501,name:"bleak"},{id:502,name:"gangster"}]},credits:{cast:[],crew:[]},videos:{results:[]},images:{logos:[]},release_date:"1990-01-01"};}
    return new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}});
  }) as typeof fetch;
  try{const query="movies like Scarface but darker";const intent=deterministicIntent(query,"movie");const items=await searchMovies(query,intent);assert.ok(paths.some(p=>p.endsWith("/similar")));assert.ok(paths.some(p=>p.endsWith("/recommendations")));assert.ok(paths.includes("/3/discover/movie"));assert.ok(paths.filter(p=>p==="/3/search/keyword").length>0);assert.ok(items.some(x=>x.keywords?.includes("bleak")));}
  finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.TMDB_API_KEY;else process.env.TMDB_API_KEY=oldKey;}
});
test("niche clustering groups repeated catalog signals reproducibly",()=>{
  const samples=["crime","crime","crime","strategy","strategy","strategy"].map((topic,i)=>({id:String(i),domain:i<3?"movie":"book",weight:1,embedding:null,metadata:{id:i,title:`${topic} exploration ${i}`,type:i<3?"movie":"book",genres:[topic],keywords:topic==="crime"?["gangster","gritty"]:["power","decision-making"],people:[]}}));
  const a=clusterTaste(samples),b=clusterTaste(samples);assert.equal(a.length,2);assert.deepEqual(a.map(c=>c.name),b.map(c=>c.name));assert.deepEqual(a.map(c=>c.sample_count).sort(),[3,3]);assert.ok(a.some(c=>c.signals.includes("crime")));assert.ok(a.some(c=>c.signals.includes("strategy")));
});
test("music mood and activity intent becomes semantic signals without invented preferences",()=>{
  const sad=deterministicIntent("sad Hindi songs","music");
  assert.equal(sad.language,"hi");assert.ok(sad.semantic_concepts.includes("melancholic"));assert.equal(sad.experience_level,null);
  const focus=deterministicIntent("music for coding","music");
  assert.ok(focus.semantic_concepts.includes("deep work"));assert.ok(focus.semantic_concepts.includes("instrumental"));
  const broad=deterministicIntent("music","music");
  assert.equal(broad.language,null);assert.deepEqual(broad.mood,[]);assert.equal(broad.seed_entities.length,0);
});
test("theme queries preserve concepts for metadata and semantic discovery",()=>{
  for(const [query,theme] of [["movies about revenge","revenge"],["books about human nature","human nature"],["songs about loneliness","loneliness"]] as const){
    const intent=deterministicIntent(query,query.startsWith("books")?"book":query.startsWith("songs")?"music":"movie");
    assert.ok(intent.themes.includes(theme));assert.ok(intent.semantic_concepts.length>0);
  }
});
test("music activity discovery uses semantic iTunes terms, not the literal sentence",async()=>{
  const oldFetch=globalThis.fetch;const urls:URL[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{const url=new URL(String(input));urls.push(url);return new Response(JSON.stringify({results:[{trackId:1,trackName:"Focus",artistName:"Instrumental Ensemble",primaryGenreName:"Ambient"}]}),{status:200,headers:{"Content-Type":"application/json"}});}) as typeof fetch;
  try{const query="music for coding";const items=await (await import("../src/lib/providers")).searchMusic(query,deterministicIntent(query,"music"));assert.ok(items.some(x=>x.type==="track"));const apple=urls.find(x=>x.hostname==="itunes.apple.com");assert.ok(apple);assert.match(apple.searchParams.get("term")??"",/coding|focus|instrumental|deep work/i);assert.doesNotMatch(apple.searchParams.get("term")??"",/music for coding/i);}
  finally{globalThis.fetch=oldFetch;}
});
test("album queries request first-class iTunes album entities",async()=>{
  const oldFetch=globalThis.fetch;const urls:URL[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{const url=new URL(String(input));urls.push(url);return new Response(JSON.stringify({results:[{collectionId:99,collectionName:"Selected Ambient Works",artistName:"Aphex Twin",trackCount:13,primaryGenreName:"Electronic",artworkUrl100:"https://is1-ssl.mzstatic.com/image.jpg",releaseDate:"1992-01-01T00:00:00Z",collectionViewUrl:"https://music.apple.com/album/99"}]}),{status:200,headers:{"Content-Type":"application/json"}});}) as typeof fetch;
  try{const query="albums like Selected Ambient Works";const intent=deterministicIntent(query,"music");assert.equal(intent.entity_type,"album");const {searchMusic}=await import("../src/lib/providers");const items=await searchMusic(query,intent);const album=items.find(x=>x.type==="album");assert.ok(album);assert.equal(album.title,"Selected Ambient Works");assert.equal(album.description,"Aphex Twin");assert.ok(urls.some(url=>url.hostname==="itunes.apple.com"&&url.searchParams.get("entity")==="album"));}
  finally{globalThis.fetch=oldFetch;}
});
test("book similarity expands a seed into works with overlapping subjects",async()=>{
  const oldFetch=globalThis.fetch;const subjects:string[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{const url=new URL(String(input));const subject=url.searchParams.get("subject");if(subject)subjects.push(subject);const docs=subject?[{key:`/works/${subject.replaceAll(" ","_")}`,title:subject==="Space operas"?"The Dispossessed":"A Fire Upon the Deep",author_name:["Ursula K. Le Guin"],subject:[subject],cover_i:42}]:[{key:"/works/dune",title:"Dune",author_name:["Frank Herbert"],subject:["Science fiction","Space operas","Desert planets"],cover_i:1}];return new Response(JSON.stringify({docs}),{status:200,headers:{"Content-Type":"application/json"}});}) as typeof fetch;
  try{const query="books like Dune";const {searchExternal}=await import("../src/lib/providers");const items=await searchExternal(query,"book",deterministicIntent(query,"book"));assert.ok(subjects.includes("Space operas"));assert.ok(items.some(item=>item.title==="The Dispossessed"));assert.ok(!items.some(item=>item.title==="Dune"));assert.ok(items.some(item=>Array.isArray(item.evidence?.seed_genres)));}
  finally{globalThis.fetch=oldFetch;}
});
