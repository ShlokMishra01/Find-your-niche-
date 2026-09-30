CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS taste_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain text NOT NULL CHECK(domain IN ('movie','tv','book','music','code')),
  entity_type text NOT NULL, provider text NOT NULL, external_id text NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, embedding vector(1536), embedding_model text, embedding_version text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, external_id)
);
CREATE TABLE IF NOT EXISTS entity_metadata (
  entity_id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  genres text[] NOT NULL DEFAULT '{}', keywords text[] NOT NULL DEFAULT '{}', people text[] NOT NULL DEFAULT '{}',
  language text, country text, industry text, release_year smallint, runtime integer, provider_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS entity_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE, relationship text NOT NULL,
  provider text NOT NULL DEFAULT 'derived', confidence real NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1), metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(source_entity_id,target_entity_id,relationship)
);
CREATE TABLE IF NOT EXISTS interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK(event_type IN ('VIEW','LIKE','UNLIKE','DISLIKE','UNDISLIKE','SAVE','UNSAVE','RATE','SKIP','COMPLETE')),
  weight real NOT NULL DEFAULT 0, value smallint CHECK(value BETWEEN 1 AND 5), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_entity_states (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  saved boolean NOT NULL DEFAULT false, reaction text CHECK(reaction IN ('LIKE','DISLIKE') OR reaction IS NULL), rating smallint CHECK(rating BETWEEN 1 AND 5),
  view_count integer NOT NULL DEFAULT 0, skipped boolean NOT NULL DEFAULT false, completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,entity_id)
);
CREATE TABLE IF NOT EXISTS taste_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES entities(id) ON DELETE CASCADE, name text NOT NULL, node_type text NOT NULL,
  weight real NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,name,node_type)
);
CREATE TABLE IF NOT EXISTS taste_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_node_id uuid NOT NULL REFERENCES taste_nodes(id) ON DELETE CASCADE, target_node_id uuid NOT NULL REFERENCES taste_nodes(id) ON DELETE CASCADE,
  edge_type text NOT NULL, weight real NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,source_node_id,target_node_id,edge_type)
);
CREATE TABLE IF NOT EXISTS niches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL, description text, centroid vector(1536), metadata jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS user_niches (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, niche_id uuid NOT NULL REFERENCES niches(id) ON DELETE CASCADE, score real NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,niche_id));
CREATE TABLE IF NOT EXISTS recommendation_cache (
  cache_key text PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE CASCADE, taste_version bigint NOT NULL DEFAULT 0,
  payload jsonb NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_search_cache (
  cache_key text PRIMARY KEY, domain text NOT NULL, payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS embeddings (
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE, model text NOT NULL, version text NOT NULL,
  embedding vector(1536) NOT NULL, source_hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(entity_id,model,version)
);
CREATE TABLE IF NOT EXISTS social_connections (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, connected_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,connected_user_id));
CREATE TABLE IF NOT EXISTS feed_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE, kind text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS search_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, query text NOT NULL, domain text NOT NULL, intent text, created_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS entities_domain_updated_idx ON entities(domain,updated_at DESC);
CREATE INDEX IF NOT EXISTS entities_provider_external_idx ON entities(provider,external_id);
CREATE INDEX IF NOT EXISTS entities_search_idx ON entities USING GIN(to_tsvector('simple',coalesce(title,'')||' '||coalesce(description,'')));
CREATE INDEX IF NOT EXISTS entities_metadata_idx ON entities USING GIN(metadata jsonb_path_ops);
CREATE INDEX IF NOT EXISTS entities_embedding_idx ON entities USING hnsw(embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS entity_metadata_genres_idx ON entity_metadata USING GIN(genres);
CREATE INDEX IF NOT EXISTS entity_metadata_keywords_idx ON entity_metadata USING GIN(keywords);
CREATE INDEX IF NOT EXISTS entity_metadata_region_idx ON entity_metadata(language,country,industry,release_year);
CREATE INDEX IF NOT EXISTS entity_relationship_target_idx ON entity_relationships(target_entity_id,relationship);
CREATE INDEX IF NOT EXISTS interactions_user_recent_idx ON interactions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS interactions_user_event_idx ON interactions(user_id,event_type,entity_id);
CREATE INDEX IF NOT EXISTS user_entity_state_idx ON user_entity_states(user_id,saved,reaction,updated_at DESC);
CREATE INDEX IF NOT EXISTS taste_nodes_user_weight_idx ON taste_nodes(user_id,weight DESC);
CREATE INDEX IF NOT EXISTS taste_edges_user_source_idx ON taste_edges(user_id,source_node_id);
CREATE INDEX IF NOT EXISTS embeddings_vector_idx ON embeddings USING hnsw(embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS search_history_user_recent_idx ON search_history(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS catalog_search_cache_expiry_idx ON catalog_search_cache(expires_at);
