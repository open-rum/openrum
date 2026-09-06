CREATE TABLE retention_change_previews (
  token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_days SMALLINT NOT NULL CHECK (raw_days BETWEEN 1 AND 90),
  aggregate_days SMALLINT NOT NULL CHECK (aggregate_days BETWEEN 1 AND 730),
  affected_rows BIGINT NOT NULL CHECK (affected_rows >= 0),
  delete_rows BIGINT NOT NULL CHECK (delete_rows >= 0 AND delete_rows <= affected_rows),
  plan_json JSONB NOT NULL CHECK (jsonb_typeof(plan_json) = 'array'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX retention_change_previews_expiry_idx
  ON retention_change_previews (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE maintenance_jobs (
  id UUID PRIMARY KEY,
  job_type VARCHAR(32) NOT NULL CHECK (job_type = 'retention_cleanup'),
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry', 'completed', 'failed')),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  raw_days SMALLINT NOT NULL CHECK (raw_days BETWEEN 1 AND 90),
  aggregate_days SMALLINT NOT NULL CHECK (aggregate_days BETWEEN 1 AND 730),
  affected_rows BIGINT NOT NULL CHECK (affected_rows >= 0),
  delete_rows BIGINT NOT NULL CHECK (delete_rows >= 0 AND delete_rows <= affected_rows),
  total_steps INTEGER NOT NULL CHECK (total_steps >= 0),
  completed_steps INTEGER NOT NULL DEFAULT 0 CHECK (completed_steps >= 0 AND completed_steps <= total_steps),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  last_error VARCHAR(512) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (completed_at IS NULL OR status = 'completed')
);

CREATE INDEX maintenance_jobs_pending_idx
  ON maintenance_jobs (next_attempt_at, created_at)
  WHERE status IN ('queued', 'running', 'retry');
CREATE INDEX maintenance_jobs_created_idx ON maintenance_jobs (created_at DESC);

CREATE TABLE maintenance_job_steps (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES maintenance_jobs(id) ON DELETE CASCADE,
  table_name VARCHAR(64) NOT NULL,
  time_column VARCHAR(32) NOT NULL,
  month_key INTEGER NOT NULL CHECK (month_key BETWEEN 200001 AND 999912),
  retention_days SMALLINT NOT NULL CHECK (retention_days BETWEEN 1 AND 730),
  affected_rows BIGINT NOT NULL CHECK (affected_rows > 0),
  delete_rows BIGINT NOT NULL CHECK (delete_rows >= 0 AND delete_rows <= affected_rows),
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error VARCHAR(512) NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, table_name, month_key)
);

CREATE INDEX maintenance_job_steps_pending_idx
  ON maintenance_job_steps (next_attempt_at, id)
  WHERE status IN ('queued', 'running', 'retry');
