export type Domain = "movie" | "book" | "music" | "code";
export type RequestedDomain = Domain | "all";
export type IntentKind = "SEARCH" | "SIMILAR" | "FILTERED_SIMILAR" | "DISCOVER" | "RECOMMEND" | "CROSS_DOMAIN" | "PERSONALIZED" | "ENTITY_LOOKUP" | "PEOPLE_SEARCH";
export type QueryIntent = {
  domain: Domain; intent: IntentKind; entity_type: string | null; seed_entities: string[];
  genres: string[]; themes: string[]; keywords: string[]; tone: string[]; mood: string[];
  era: string | null; language: string | null; country: string | null; industry: string | null;
  people: string[]; runtime: { min: number | null; max: number | null };
  year_range: { min: number | null; max: number | null }; novelty: number; user_personalization: boolean;
  semantic_concepts: string[]; modifier_signals: string[];
  experience_level?: "beginner" | "intermediate" | "advanced" | null; selected_terms?: string[];
};

export const intentKinds: IntentKind[] = ["SEARCH", "SIMILAR", "FILTERED_SIMILAR", "DISCOVER", "RECOMMEND", "CROSS_DOMAIN", "PERSONALIZED", "ENTITY_LOOKUP", "PEOPLE_SEARCH"];
const domains: Domain[] = ["movie", "book", "music", "code"];
/** Route unpinned universal searches to a catalog using explicit domain words and stable topic cues. */
export function routeDomain(query: string): Domain {
  const q=query.toLocaleLowerCase();
  const cues: [Domain, RegExp][] = [["book",/\b(book|books|read|reading|novel|author|literature)\b/],["music",/\b(song|songs|music|listen|listening|artist|artists|album|albums|track|tracks|hip[- ]?hop|k-?pop)\b/],["movie",/\b(movie|movies|film|films|watch|watching|tv|series|show|shows|cinema|actor|actress|director)\b/],["code",/\b(rag|llm|llms|github|repo|repository|repositories|code|coding|api|vector database|fastapi|opencv|computer vision|ai agent|ai agents|framework|frameworks|project|projects)\b/]];
  const matches=cues.flatMap(([domain,re])=>{const m=re.exec(q);return m?[{domain,index:m.index}]:[]}).sort((a,b)=>a.index-b.index);
  return matches[0]?.domain??"movie";
}
const strings = (v: unknown, max = 12) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map(x => x.trim().slice(0, 80)).filter(Boolean).slice(0, max) : [];
const obj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const year = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1870 && v <= new Date().getFullYear() + 5 ? v : null;
function range(v: unknown, max: number) { const o = obj(v); const min = typeof o.min === "number" && Number.isFinite(o.min) ? Math.max(0, Math.min(max, o.min)) : null; const hi = typeof o.max === "number" && Number.isFinite(o.max) ? Math.max(0, Math.min(max, o.max)) : null; return { min, max: hi }; }

export function validateIntent(raw: unknown, expectedDomain: Domain): QueryIntent | null {
  const o = obj(raw); if (o.domain !== expectedDomain || !domains.includes(o.domain as Domain) || !intentKinds.includes(o.intent as IntentKind)) return null;
  const intent = o.intent as IntentKind;
  return {
    domain: expectedDomain, intent,
    entity_type: typeof o.entity_type === "string" ? o.entity_type.slice(0, 40) : null,
    seed_entities: strings(o.seed_entities, 4), genres: strings(o.genres), themes: strings(o.themes), keywords: strings(o.keywords),
    tone: strings(o.tone, 8), mood: strings(o.mood, 8), era: typeof o.era === "string" ? o.era.slice(0, 40) : null,
    language: typeof o.language === "string" ? o.language.slice(0, 30) : null, country: typeof o.country === "string" ? o.country.slice(0, 30) : null,
    industry: typeof o.industry === "string" ? o.industry.slice(0, 50) : null, people: strings(o.people, 8), runtime: range(o.runtime, 600),
    year_range: { min: year(obj(o.year_range).min), max: year(obj(o.year_range).max) },
    novelty: typeof o.novelty === "number" && Number.isFinite(o.novelty) ? Math.max(0, Math.min(1, o.novelty)) : 0.25,
    user_personalization: o.user_personalization === true,
    semantic_concepts: strings(o.semantic_concepts, 16), modifier_signals: strings(o.modifier_signals, 8),
    experience_level: ["beginner","intermediate","advanced"].includes(String(o.experience_level)) ? o.experience_level as "beginner"|"intermediate"|"advanced" : null,
    selected_terms: strings(o.selected_terms, 12),
  };
}

const genreWords: Record<string, string[]> = {
  action: ["action"], adventure: ["adventure"], animation: ["animation"], comedy: ["comedy"], crime: ["crime"], documentary: ["documentary"], drama: ["drama"], fantasy: ["fantasy"], history: ["history"], horror: ["horror"], mystery: ["mystery"], romance: ["romance"], "science fiction": ["science fiction", "sci-fi"], thriller: ["thriller", "psychological thriller"], war: ["war"], western: ["western"],
};
const modifiers: Record<string, string[]> = {
  darker: ["dark", "gritty", "bleak", "neo-noir", "morally complex", "violence"], dark: ["dark", "gritty", "bleak", "neo-noir", "morally complex"], gritty: ["gritty", "realistic", "crime"], disturbing: ["disturbing", "bleak", "psychological"], violent: ["violence", "crime", "intense"], intense: ["intense", "suspense", "violence"], psychological: ["psychological", "mind games", "obsession"], noir: ["neo-noir", "detective", "corruption"], sadder: ["melancholic", "emotional", "slow", "romantic"], sad: ["melancholic", "emotional", "slow"], happy: ["happy", "upbeat", "feel-good"], chill: ["chill", "relaxed", "downtempo"], peaceful: ["peaceful", "calm", "ambient"], energetic: ["energetic", "upbeat", "high energy"], motivational: ["motivational", "uplifting", "confidence"], nostalgic: ["nostalgic", "memories", "retro"], dreamy: ["dreamy", "ethereal", "atmospheric"], relaxing: ["relaxing", "calm", "ambient"], romantic: ["romantic", "love", "emotional"], melancholic: ["melancholic", "sad", "emotional"], "late-night": ["late night", "ambient", "downtempo"], slower: ["slow", "downtempo", "ballad"], faster: ["fast", "upbeat", "high energy"], practical: ["practical", "applied", "hands-on"], easier: ["accessible", "introductory", "beginner-friendly"], shorter: ["short", "concise", "brief"],
};
const conceptTerms:Record<string,string[]>={ambition:["ambition","power","rise and fall"],power:["power","strategy","status"],strategy:["strategy","decision-making","power"],gangster:["gangster","crime","organized crime"],heartbreak:["heartbreak","melancholy","romance"],experimental:["experimental","avant-garde"],"hip hop":["hip hop","rap"],revenge:["revenge","vengeance","retribution"],betrayal:["betrayal","deception","trust"],greed:["greed","ambition","wealth"],obsession:["obsession","fixation","compulsion"],corruption:["corruption","power","abuse of power"],loneliness:["loneliness","isolation","alienation"],identity:["identity","self-discovery","belonging"],leadership:["leadership","authority","responsibility"],sacrifice:["sacrifice","duty","loss"],redemption:["redemption","forgiveness","second chances"],manipulation:["manipulation","deception","influence"],love:["love","romance","relationship"],friendship:["friendship","loyalty","companionship"],success:["success","achievement","ambition"],confidence:["confidence","self-belief","empowerment"],failure:["failure","setback","resilience"],"human nature":["human nature","psychology","behavior"],discipline:["discipline","habits","self-control"],"decision making":["decision making","judgment","strategy"],creativity:["creativity","creative process","innovation"],"coming of age":["coming of age","adolescence","growing up"]};
const activities:Record<string,string[]>={studying:["focus","instrumental","low distraction","study"],study:["focus","instrumental","low distraction","study"],coding:["focus","instrumental","deep work","coding"],gym:["workout","high energy","motivation"],running:["running","steady tempo","upbeat"],driving:["driving","road trip","steady"],travelling:["travel","journey","discovery"],sleeping:["sleep","ambient","calm"],relaxing:["relaxation","calm","ambient"],reading:["reading","instrumental","calm"],working:["work","focus","instrumental"],"late nights":["late night","ambient","downtempo"],parties:["party","dance","upbeat"],"road trips":["road trip","driving","upbeat"],"rainy days":["rainy day","melancholic","cozy"],coffee:["cafe","acoustic","chill"],breakup:["heartbreak","breakup","melancholic"],"deep work":["focus","instrumental","deep work"],focusing:["focus","instrumental","low distraction"],morning:["morning","uplifting","upbeat"],night:["night","late night","ambient"]};
const countries: Record<string, [string, string]> = { bollywood: ["India", "hi"], hindi: ["India", "hi"], india: ["India", ""], indian: ["India", ""], "south indian": ["India", "ta"], "tamil": ["India", "ta"], "telugu": ["India", "te"], "malayalam": ["India", "ml"], "kannada": ["India", "kn"], "marathi": ["India", "mr"], "bengali": ["India", "bn"], "punjabi": ["India", "pa"], "korean cinema": ["South Korea", "ko"], "japanese cinema": ["Japan", "ja"], hollywood: ["United States", "en"] };

export function deterministicIntent(query: string, domain: Domain): QueryIntent {
  const q = query.toLowerCase(); const terms = Object.keys(modifiers).sort((a,b)=>b.length-a.length).filter(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\$&")}\\b`,"i").test(q));
  const foundGenres = Object.keys(genreWords).filter(k => q.includes(k));
  const themeDetected = Object.keys(conceptTerms).some(k=>q.includes(k));
  let industry: string | null = null, country: string | null = null, language: string | null = null;
  for (const [name, [c, l]] of Object.entries(countries)) if (q.includes(name)) { industry = name === "hollywood" ? "Hollywood" : name === "bollywood" ? "Bollywood" : ["tamil", "telugu", "malayalam", "kannada", "marathi", "bengali", "punjabi", "south indian"].includes(name) ? "South Indian" : name === "hindi" || name === "india" || name === "indian" ? null : name; country = c; language = l || null; break; }
  const isPeople = /\b(starring|with|featuring|by|sung by|actor|actress|singer|artist)\b/i.test(q);
  const hasLike = /\b(like|similar to|artists similar|songs like|books like)\b/i.test(q);
  const hasModifier = terms.length > 0;
  const activity=domain==="music"?Object.keys(activities).find(k=>new RegExp(`\\b${k}\\b`,"i").test(q)):undefined;
  const years = q.match(/\b((?:19|20)\d{2}|(?:70|80|90|00|10|20))s?\b/); const decade = years?.[1].length === 2 ? Number(years[1]) < 30 ? 2000 + Number(years[1]) : 1900 + Number(years[1]) : null; const yearRange = years ? { min: decade ? Math.floor(decade/10)*10 : Number(years[1]), max: decade ? Math.floor(decade/10)*10+9 : Number(years[1]) } : { min: null, max: null };
  const subjectPhrase = q.replace(/\b(find|show|me|some|good|great|best|movies?|films?|tv|shows?|series|books?|songs?|music|artists?|projects?|repositories|repos|like|similar to|about|by|with|starring|featuring|bollywood|hollywood|indian|crime|thriller|psychological|dark|darker|hindi|tamil|telugu|punjabi|90s|80s|70s|2000s|python|javascript|typescript|golang|go|rust|java|c\+\+|ruby|php|swift|kotlin|beginner|beginners|entry.level|newcomer|intermediate|advanced|expert|rag|projects?)\b/gi, " ").replace(/\s+/g, " ").trim();
  const likeCapture = q.match(/\b(?:like|similar to)\s+(.+?)(?:\s+but\b|\s+with\b|$)/i);
  const seed = hasLike ? (likeCapture?.[1]?.replace(/[,;].*$/, "").trim() || subjectPhrase || "") : "";
  const codeTopic=domain==="code"?(q.match(/\b(rag|llm|ai agents?|computer vision|fastapi|opencv|vector databases?|machine learning|llm evaluation)\b/i)?.[0]??null):null;
  const intent: IntentKind = /what (do|kind of).*(like|niche)|my .* niche/i.test(q) ? "PERSONALIZED" : /something unexpected|surprise me/i.test(q) ? "DISCOVER" : hasLike && hasModifier ? "FILTERED_SIMILAR" : hasLike ? "SIMILAR" : (foundGenres.length || industry || language || country || yearRange.min || themeDetected || Boolean(activity) || Boolean(codeTopic) || domain==="code"&&/\b(projects?|repositories|repos)\b/i.test(q)) ? "DISCOVER" : isPeople ? "PEOPLE_SEARCH" : subjectPhrase ? "ENTITY_LOOKUP" : "SEARCH";
  const experience= /\b(beginner|beginners|entry.level|newcomer)\b/i.test(q)?"beginner":/\b(intermediate)\b/i.test(q)?"intermediate":/\b(advanced|expert)\b/i.test(q)?"advanced":null;
  const codeLanguageRaw=domain==="code"?(q.match(/\b(python|javascript|typescript|golang|go|rust|java|c\+\+|ruby|php|swift|kotlin)\b/i)?.[1]??null):null;
  const codeLanguage=codeLanguageRaw?({python:"Python",javascript:"JavaScript",typescript:"TypeScript",golang:"Go",go:"Go",rust:"Rust",java:"Java","c++":"C++",ruby:"Ruby",php:"PHP",swift:"Swift",kotlin:"Kotlin"} as Record<string,string>)[codeLanguageRaw.toLowerCase()]??codeLanguageRaw:null;
  if(domain==="code"&&codeLanguage)language=codeLanguage;
  const themes=Object.keys(conceptTerms).filter(k=>new RegExp(`\\b${k.replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\$&")}\\b`,"i").test(q));
  const concepts = [...new Set([...terms.flatMap(t => modifiers[t]), ...foundGenres.flatMap(g => genreWords[g]), ...themes.flatMap(t=>conceptTerms[t]), ...(activity?activities[activity]:[]), ...(codeLanguage?[codeLanguage]:[]), ...(experience?[experience]:[]), ...(industry ? [industry, country ?? "", language ?? ""] : [])])].filter(Boolean);
  const modifiersAndConcepts=[...new Set([...terms,...themes,...foundGenres,...(activity?[activity]:[]),...(codeLanguage?[codeLanguage]:[]),...(codeTopic?[codeTopic.toUpperCase()==="RAG"?"RAG":codeTopic]:[])])];
  return { domain, intent, entity_type: isPeople ? (domain === "music" ? "artist" : "person") : /\b(tv|series|show)\b/i.test(q) ? "tv" : domain==="music"&&/\balbums?\b/i.test(q)?"album":domain==="music"&&/\b(song|songs|track|tracks)\b/i.test(q)?"track":null, seed_entities: seed ? [seed] : [], genres: foundGenres, themes, keywords: concepts, tone: terms, mood: terms, era: years?.[0] ?? null, language, country, industry, people: isPeople&&!hasLike&&subjectPhrase?[subjectPhrase]:[], runtime: { min: null, max: null }, year_range: yearRange, novelty: /unexpected|surprise|obscure|less mainstream/i.test(q) ? 0.8 : 0.2, user_personalization: intent === "PERSONALIZED", semantic_concepts: concepts, modifier_signals: [...terms,...(experience?[experience]:[])], experience_level:experience, selected_terms:modifiersAndConcepts };
}

export async function parseIntent(query: string, domain: Domain): Promise<{ intent: QueryIntent; source: "openrouter" | "deterministic" }> {
  const key = process.env.OPENROUTER_API_KEY; if (!key) return { intent: deterministicIntent(query, domain), source: "deterministic" };
  const schema = `Return one JSON object with fields: domain, intent, entity_type, seed_entities, genres, themes, keywords, tone, mood, era, language, country, industry, people, runtime {min,max}, year_range {min,max}, novelty (0..1), user_personalization, semantic_concepts, modifier_signals, experience_level, selected_terms. domain must be ${domain}; intent one of ${intentKinds.join(", ")}. Arrays are strings. Use null for missing values. Extract only the user's stated intent; do not invent seed entities, language, programming language, experience level, genre, region, or filters. Only set experience_level when explicitly requested. selected_terms lists explicitly stated topics/filters relevant to UI chips. Convert modifiers to observable retrieval concepts, e.g. darker -> gritty, bleak, neo-noir, morally complex; these are ranking signals, not facts. A request for like X but darker is FILTERED_SIMILAR with seed X.`;
  try {
    for(let attempt=0;attempt<2;attempt++) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENROUTER_REASONING_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free", temperature: 0, max_tokens: 700, response_format: { type: "json_object" }, messages: [{ role: "system", content: schema }, { role: "user", content: JSON.stringify({ domain, query: query.slice(0, 400), ...(attempt?{correction:"Your previous response was missing or invalid. Return one schema-valid JSON object; do not add unstated preferences."}:{}) }) }] }), signal: AbortSignal.timeout(5_500) });
      if (!res.ok) continue;
      try { const content = (await res.json()).choices?.[0]?.message?.content; const parsed = validateIntent(typeof content === "string" ? JSON.parse(content) : null, domain); if (parsed) {
        const grounded=deterministicIntent(query,domain);
        // A broad, constrained discovery query is not an entity lookup just
        // because the model supplied a plausible-looking intent label.
        if(grounded.intent==="DISCOVER"&&!grounded.seed_entities.length&&["ENTITY_LOOKUP","SEARCH"].includes(parsed.intent))return {intent:grounded,source:"deterministic"};
        return { intent: parsed, source: "openrouter" };
      } } catch { /* one bounded correction attempt follows */ }
    }
  } catch (error) { console.warn("Intent extraction unavailable; using deterministic parser:", error instanceof Error ? error.message : "unknown"); }
  return { intent: deterministicIntent(query, domain), source: "deterministic" };
}
