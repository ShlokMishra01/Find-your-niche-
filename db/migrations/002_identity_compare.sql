CREATE TABLE IF NOT EXISTS auth_accounts (
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS auth_accounts_user_idx ON auth_accounts(user_id);

-- Public identifier is deliberately separate from the internal users.id.
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_share_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS users_public_share_id_idx ON users(public_share_id);

CREATE TABLE IF NOT EXISTS comparison_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired'))
);

CREATE INDEX IF NOT EXISTS comparison_shares_owner_idx ON comparison_shares(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comparison_shares_expiry_idx ON comparison_shares(expires_at) WHERE revoked_at IS NULL;
