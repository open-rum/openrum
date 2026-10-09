-- Queue of releases whose recent error events should be mapped again because a
-- Source Map Artifact became ready after those events were first processed.
-- At most one pending request exists per release build; a later upload bumps
-- requested_at so an in-flight run does not mark the newer upload as handled.
CREATE TABLE sourcemap_remap_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version VARCHAR(128) NOT NULL CHECK (char_length(version) BETWEEN 1 AND 128),
  dist VARCHAR(64) NOT NULL DEFAULT '' CHECK (char_length(dist) <= 64),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000),
  last_error VARCHAR(512),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sourcemap_remap_requests_pending_idx
  ON sourcemap_remap_requests (project_id, version, dist)
  WHERE processed_at IS NULL;

CREATE INDEX sourcemap_remap_requests_due_idx
  ON sourcemap_remap_requests (requested_at)
  WHERE processed_at IS NULL;
