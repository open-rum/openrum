-- Keep the legacy auth_source/oidc_subject columns for existing installations.
-- New identities are scoped to an immutable provider ID and stable subject.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_source_check;
ALTER TABLE users ADD CONSTRAINT users_auth_source_check
  CHECK (auth_source IN ('local', 'oidc', 'google', 'github', 'ldap'));
ALTER TABLE users ADD CONSTRAINT users_local_password_check
  CHECK (auth_source <> 'local' OR password_hash IS NOT NULL);
ALTER TABLE users ADD COLUMN access_status VARCHAR(16) NOT NULL DEFAULT 'approved'
  CHECK (access_status IN ('approved', 'pending'));

CREATE TABLE auth_providers (
  id VARCHAR(40) PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{0,39}$'),
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('google', 'github', 'oidc', 'ldap')),
  label VARCHAR(80) NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  identity_scope TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT false,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id VARCHAR(40) NOT NULL REFERENCES auth_providers(id) ON DELETE RESTRICT,
  subject VARCHAR(512) NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, subject),
  UNIQUE (user_id, provider_id)
);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);
