import type { QueryIntent } from "./intent";

export type Candidate = { id: string | number; domain?: string; type: string; title: string; year?: string | number; description?: string; image?: string | null; backdrop?: string | null; rating?: number | null; url?: string; details?: string[]; genres?: string[]; keywords?: string[]; people?: string[]; language?: string; country?: string; runtime?: number | null; provider?: string; sources?: string[]; evidence?: Record<string, number | string[] | string>; provider_data?: Record<string, unknown> };
export const rankingWeights = { semantic_similarity: .25, seed_similarity: .20, genre_match: .10, keyword_match: .10, mood_match: .10, taste_affinity: .10, graph_similarity: .05, novelty: .05, diversity: .05 } as const;
const normalize = (s: string) => s.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(x => x.length > 2);
const overlap = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.sqrt(A.size * B.size); };
export function rerank(query: string, intent: QueryIntent, candidates: Candidate[], taste: string[] = [], seen: Set<string> = new Set(), avoid: string[] = []): Candidate[] {
  const q = normalize(query + " " + intent.semantic_concepts.join(" "));
  const seed = normalize(intent.seed_entities.join(" "));
  const genre = intent.genres.flatMap(normalize);
  const keywords = [...intent.keywords, ...intent.themes].flatMap(normalize);
  const mood = [...intent.tone, ...intent.mood, ...intent.semantic_concepts].flatMap(normalize);
  const seenIds = seen;
  const scored = candidates.map((candidate, index) => {
    const text = normalize([candidate.title, candidate.description, ...(candidate.genres ?? []), ...(candidate.keywords ?? []), ...(candidate.people ?? []), ...(candidate.details ?? [])].join(" "));
    const exactEntity = intent.intent === "ENTITY_LOOKUP" && normalize(candidate.title).join(" ") === normalize(query).join(" ");
    const seedGenres = Array.isArray(candidate.evidence?.seed_genres) ? candidate.evidence.seed_genres : [];
    const seedKeywords = Array.isArray(candidate.evidence?.seed_keywords) ? candidate.evidence.seed_keywords : [];
    const seedPeople = Array.isArray(candidate.evidence?.seed_people) ? candidate.evidence.seed_people : [];
    const vector = Number(candidate.evidence?.vector_similarity ?? 0);
    const collaborative = Number(candidate.evidence?.collaborative_score ?? 0);
    const metadataSeedMatch=Math.max(overlap(normalize(seedGenres.join(" ")),normalize((candidate.genres??[]).join(" "))),overlap(normalize(seedKeywords.join(" ")),normalize((candidate.keywords??[]).join(" "))),overlap(normalize(seedPeople.join(" ")),normalize((candidate.people??[]).join(" "))));
    const components = { semantic_similarity: Math.max(overlap(q, text), exactEntity?1:0, Number.isFinite(vector) ? Math.max(0,Math.min(1,vector)) : 0), seed_similarity: Math.max(overlap(seed, text),metadataSeedMatch,exactEntity?1:0,(candidate.sources?.includes("similar") || candidate.sources?.includes("recommendations")) ? .35 : 0), genre_match: Math.max(overlap(genre, normalize((candidate.genres ?? []).join(" "))),seed.length?overlap(normalize(seedGenres.join(" ")),normalize((candidate.genres??[]).join(" "))):0), keyword_match: Math.max(overlap(keywords, normalize((candidate.keywords ?? []).join(" "))),seed.length?overlap(normalize(seedKeywords.join(" ")),normalize((candidate.keywords??[]).join(" "))):0), mood_match: overlap(mood, text), taste_affinity: Math.max(overlap(normalize(taste.join(" ")), text), Number.isFinite(collaborative) ? Math.min(.7,collaborative/4) : 0), graph_similarity: overlap(normalize(intent.semantic_concepts.join(" ")), normalize([...(candidate.genres ?? []), ...(candidate.keywords ?? [])].join(" "))), novelty: intent.novelty * (1 - (candidate.sources?.includes("query") ? .35 : 0)), diversity: Math.min(.35, index / Math.max(1, candidates.length) * .35) };
    const weighted = Object.entries(rankingWeights).reduce((sum, [key, weight]) => sum + components[key as keyof typeof components] * weight, 0);
    const provider=String(candidate.provider??candidate.domain); const identity = `${candidate.domain}:${provider.replace(/^tmdb$/,"tmdb")}:${candidate.provider_data?.provider_id ?? candidate.id}`;
    const displayIdentity = provider === "tmdb" ? `tmdb:${candidate.domain ?? "movie"}:${candidate.provider_data?.provider_id ?? candidate.id}` : `${provider}:${candidate.provider_data?.provider_id ?? candidate.id}`;
    const seenPenalty = seenIds.has(identity) || seenIds.has(displayIdentity) ? 1.5 : 0;
    const negativePenalty = overlap(normalize(avoid.join(" ")),text) * .65;
    const yearPenalty = intent.year_range.min && Number(candidate.year) && (Number(candidate.year) < intent.year_range.min || (intent.year_range.max && Number(candidate.year) > intent.year_range.max)) ? .3 : 0;
    candidate.evidence = { ...components, score: Number((weighted-seenPenalty-yearPenalty-negativePenalty).toFixed(4)), negative_preference_penalty:Number(negativePenalty.toFixed(3)), signals: [...(candidate.genres ?? []).filter(g => intent.genres.includes(g.toLowerCase())), ...(candidate.keywords ?? []).filter(k => intent.semantic_concepts.some(c => c.toLowerCase() === k.toLowerCase()))].slice(0, 8) };
    return { candidate, score: weighted - seenPenalty - yearPenalty - negativePenalty };
  });
  // Greedy MMR-style ordering: discourage repeated genre/people after selecting a strong match.
  const out: Candidate[] = []; const pool = [...scored];
  while (pool.length) {
    pool.sort((a, b) => { const penalty = (x: Candidate) => out.length ? overlap(normalize([...(x.genres ?? []), ...(x.people ?? [])].join(" ")), normalize(out.slice(-3).flatMap(y => [...(y.genres ?? []), ...(y.people ?? [])]).join(" "))) * .12 : 0; return (b.score - penalty(b.candidate)) - (a.score - penalty(a.candidate)); });
    out.push(pool.shift()!.candidate);
  }
  return out;
}
