CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  password_hash TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  auth_source VARCHAR(16) NOT NULL DEFAULT 'local' CHECK (auth_source IN ('local', 'oidc')),
  oidc_subject VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (auth_source = 'local' AND password_hash IS NOT NULL AND oidc_subject IS NULL)
    OR (auth_source = 'oidc' AND password_hash IS NULL AND oidc_subject IS NOT NULL)
  )
);

CREATE UNIQUE INDEX users_oidc_subject_unique
  ON users (oidc_subject)
  WHERE auth_source = 'oidc';

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  slug VARCHAR(63) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX organization_members_user_organization_idx
  ON organization_members (user_id, organization_id);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  slug VARCHAR(63) NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  environment VARCHAR(64) NOT NULL DEFAULT 'production'
    CHECK (environment ~ '^[a-z][a-z0-9_-]{0,63}$'),
  retention_days SMALLINT NOT NULL DEFAULT 14 CHECK (retention_days BETWEEN 1 AND 90),
  event_sample_rate DOUBLE PRECISION NOT NULL DEFAULT 1
    CHECK (event_sample_rate BETWEEN 0 AND 1),
  api_sample_rate DOUBLE PRECISION NOT NULL DEFAULT 0.2
    CHECK (api_sample_rate BETWEEN 0 AND 1),
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'deleting')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX projects_organization_status_idx
  ON projects (organization_id, status);

CREATE TABLE project_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_prefix VARCHAR(16) NOT NULL CHECK (char_length(key_prefix) BETWEEN 8 AND 16),
  key_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(key_hash) = 32),
  name VARCHAR(120) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, key_prefix)
);

CREATE INDEX project_keys_active_project_idx
  ON project_keys (project_id)
  WHERE revoked_at IS NULL;

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  ip_hash BYTEA CHECK (ip_hash IS NULL OR octet_length(ip_hash) = 32),
  user_agent VARCHAR(512) NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (idle_expires_at <= expires_at)
);

CREATE INDEX sessions_active_user_expiry_idx
  ON sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL CHECK (char_length(action) BETWEEN 1 AND 120),
  resource_type VARCHAR(64) NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 64),
  resource_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object'),
  CHECK (pg_column_size(metadata) <= 16384)
);

CREATE INDEX audit_logs_organization_created_idx
  ON audit_logs (organization_id, created_at DESC);
