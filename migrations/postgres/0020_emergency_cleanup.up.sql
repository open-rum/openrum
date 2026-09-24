CREATE TABLE emergency_cleanup_previews (
  token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_bytes BIGINT NOT NULL CHECK (used_bytes >= 0),
  capacity_bytes BIGINT NOT NULL CHECK (capacity_bytes > 0),
  estimated_release_bytes BIGINT NOT NULL CHECK (estimated_release_bytes >= 0),
  projected_used_bytes BIGINT NOT NULL CHECK (projected_used_bytes >= 0),
  target_used_percent SMALLINT NOT NULL DEFAULT 85 CHECK (target_used_percent BETWEEN 1 AND 99),
  protected_after TIMESTAMPTZ NOT NULL,
  can_reach_target BOOLEAN NOT NULL,
  plan_json JSONB NOT NULL CHECK (jsonb_typeof(plan_json) = 'array'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (projected_used_bytes <= used_bytes)
);

CREATE INDEX emergency_cleanup_previews_expiry_idx
  ON emergency_cleanup_previews (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE emergency_cleanup_jobs (
  id UUID PRIMARY KEY,
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry', 'completed', 'failed')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  used_bytes_before BIGINT NOT NULL CHECK (used_bytes_before >= 0),
  capacity_bytes BIGINT NOT NULL CHECK (capacity_bytes > 0),
  estimated_release_bytes BIGINT NOT NULL CHECK (estimated_release_bytes >= 0),
  target_used_percent SMALLINT NOT NULL CHECK (target_used_percent BETWEEN 1 AND 99),
  protected_after TIMESTAMPTZ NOT NULL,
  can_reach_target BOOLEAN NOT NULL,
  total_steps INTEGER NOT NULL CHECK (total_steps > 0),
  completed_steps INTEGER NOT NULL DEFAULT 0
    CHECK (completed_steps >= 0 AND completed_steps <= total_steps),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours'),
  last_error VARCHAR(512) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (completed_at IS NULL OR status = 'completed')
);

CREATE UNIQUE INDEX emergency_cleanup_jobs_one_active_idx
  ON emergency_cleanup_jobs ((true))
  WHERE status IN ('queued', 'running', 'retry');

CREATE INDEX emergency_cleanup_jobs_created_idx
  ON emergency_cleanup_jobs (created_at DESC);

CREATE TABLE emergency_cleanup_job_steps (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES emergency_cleanup_jobs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  project_name VARCHAR(120) NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  month_key INTEGER NOT NULL CHECK (month_key BETWEEN 200001 AND 999912),
  partition_id CHAR(32) NOT NULL CHECK (partition_id ~ '^[0-9a-f]{32}$'),
  affected_rows BIGINT NOT NULL CHECK (affected_rows >= 0),
  estimated_bytes BIGINT NOT NULL CHECK (estimated_bytes >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error VARCHAR(512) NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, table_name, partition_id)
);

CREATE INDEX emergency_cleanup_job_steps_pending_idx
  ON emergency_cleanup_job_steps (next_attempt_at, id)
  WHERE status IN ('queued', 'running', 'retry');
