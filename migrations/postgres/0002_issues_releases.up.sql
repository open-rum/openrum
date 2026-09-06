CREATE TABLE releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version VARCHAR(128) NOT NULL CHECK (char_length(version) BETWEEN 1 AND 128),
  dist VARCHAR(64) NOT NULL DEFAULT '' CHECK (char_length(dist) <= 64),
  commit_sha VARCHAR(64) NOT NULL DEFAULT '' CHECK (char_length(commit_sha) <= 64),
  deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version, dist)
);

CREATE INDEX releases_project_created_idx ON releases (project_id, created_at DESC);

CREATE TABLE sourcemap_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  artifact_name VARCHAR(1024) NOT NULL CHECK (char_length(artifact_name) BETWEEN 1 AND 1024),
  oss_key TEXT NOT NULL UNIQUE CHECK (char_length(oss_key) BETWEEN 1 AND 2048),
  sha256 BYTEA NOT NULL CHECK (octet_length(sha256) = 32),
  size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 0 AND 1073741824),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  error_message VARCHAR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (release_id, artifact_name)
);

CREATE INDEX sourcemap_artifacts_release_status_idx ON sourcemap_artifacts (release_id, status);

CREATE TABLE issue_states (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint VARCHAR(128) NOT NULL CHECK (char_length(fingerprint) BETWEEN 1 AND 128),
  fingerprint_version SMALLINT NOT NULL CHECK (fingerprint_version BETWEEN 1 AND 32767),
  status VARCHAR(16) NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved', 'resolved', 'ignored')),
  assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_in_release_id UUID REFERENCES releases(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, fingerprint)
);

CREATE INDEX issue_states_project_status_idx ON issue_states (project_id, status, updated_at DESC);
CREATE INDEX issue_states_assignee_idx ON issue_states (assignee_user_id) WHERE assignee_user_id IS NOT NULL;
