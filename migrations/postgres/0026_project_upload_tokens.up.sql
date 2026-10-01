-- Project-scoped credentials for build pipelines that upload Source Map
-- Artifacts. Only the SHA-256 of the secret is stored; the plaintext is shown
-- once at creation. created_by survives user deletion as NULL so the token
-- keeps working until an Owner or Admin revokes it.
CREATE TABLE project_upload_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  token_prefix VARCHAR(16) NOT NULL CHECK (char_length(token_prefix) BETWEEN 8 AND 16),
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX project_upload_tokens_project_idx ON project_upload_tokens (project_id, created_at DESC);
