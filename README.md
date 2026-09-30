# Find Your Niche

Provider-backed discovery with structured query intent, multi-source retrieval, deterministic ranking, a PostgreSQL catalog, pgvector search, and persistent anonymous taste signals.

## Setup

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env.local`; add **rotated** `TMDB_API_KEY` and `OPENROUTER_API_KEY` values. Never reuse keys pasted into chat or committed to a repository.
3. Set `DATABASE_URL` to PostgreSQL with `pgvector` available, and generate a random `AUTH_SECRET` of at least 32 characters. The database role needs permission to create `vector` and `pgcrypto` extensions for the first migration (or have an administrator preinstall them).
4. Apply the schema with `npm run db:migrate`.
5. Start the UI with `npm run dev`; verify local behavior with `npm test` and `npm run build`.

`OPENROUTER_REASONING_MODEL` defaults to `nvidia/nemotron-3-ultra-550b-a55b:free`. `OPENROUTER_EMBEDDING_MODEL` defaults to `openai/text-embedding-3-small` and must return 1,536 dimensions for the current pgvector schema. Embedding requests require a valid OpenRouter key and may incur provider charges. If OpenRouter is unavailable, structured intent falls back to a bounded deterministic parser, catalog retrieval and ranking continue, and explanations use only computed metadata signals.

## Retrieval and ranking

`GET /api/search` extracts a validated intent (`SEARCH`, `SIMILAR`, `FILTERED_SIMILAR`, `DISCOVER`, `RECOMMEND`, `CROSS_DOMAIN`, `PERSONALIZED`, `ENTITY_LOOKUP`, or `PEOPLE_SEARCH`). Movie retrieval uses TMDB search, similar, recommendations, discover, people, and detail endpoints as appropriate. Genre, language, origin country, industry heuristic, release year, people, keywords, and runtime affect discovery before ranking. A modifier such as “darker” becomes a set of retrieval/ranking concepts; it is not asserted as a factual TMDB genre.

Catalog candidates are normalized and cached on demand. The reranker is deterministic and exposes its component scores in response evidence. It combines lexical/pgvector semantic similarity, seed, genre, metadata keyword, mood, taste, graph, novelty, and diversity signals, while penalizing seen and negative-preference matches. Candidate explanations are requested only after ranking and are grounded in those returned signals. Provider failures use local cached candidates when available; otherwise the API returns an error instead of invented content.

Music combines MusicBrainz artist/tag/relationship data and Apple Search API song metadata, India storefront selection, cover art, previews where supplied, and store links. It does not stream audio. Open Library and GitHub remain the book and repository sources. External catalog ingestion is on demand and cached.

## Persistence

The migration creates normalized entities and metadata, provider relationships, 1,536-dimensional embeddings, interactions, signed anonymous users, user entity state, taste profiles/nodes/edges, niches, collaborative signals, per-user recommendation cache, provider search cache, and indexes. `GET /api/session` creates a signed anonymous profile; `POST /api/interactions` persists like, dislike, save, rating, view, skip, and completion events. Profile updates are deterministic and invalidate that user's recommendation cache. `/api/bridge` retrieves unexplored entities connected through their stored genre, keyword, and people signals.

The app intentionally disables persistent user actions until both `DATABASE_URL` and a strong `AUTH_SECRET` are configured. Search can still use its public metadata providers when their replacement credentials are present.

Hollywood is heuristically represented by US origin country + English original language + US release region; English by itself is not treated as Hollywood. Bollywood uses India origin + Hindi original language + India region. South Indian discovery uses India origin and supported original-language filters. These are retrieval heuristics, not definitive industry classifications.

## API status

`GET /api/health` reports which services are configured without exposing their values. `GET /api/taste` returns the current account's observable exploration signals. `GET /api/bridge` returns cross-domain connections from stored entity metadata. No login provider, human identity, collaborative data at launch scale, or preloaded/bulk-harvested catalog is assumed.
