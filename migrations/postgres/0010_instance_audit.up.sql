ALTER TABLE sessions ADD COLUMN elevated_at TIMESTAMPTZ;

CREATE TABLE instance_audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  request_id VARCHAR(128) NOT NULL,
  action VARCHAR(160) NOT NULL CHECK (char_length(action) BETWEEN 1 AND 160),
  resource_type VARCHAR(64) NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 64),
  resource_path VARCHAR(512) NOT NULL,
  config_source VARCHAR(32) NOT NULL DEFAULT 'request',
  change_summary JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(change_summary) = 'object'),
  CHECK (pg_column_size(change_summary) <= 8192)
);

CREATE INDEX instance_audit_logs_created_idx ON instance_audit_logs (created_at DESC);
CREATE INDEX instance_audit_logs_actor_created_idx ON instance_audit_logs (actor_user_id, created_at DESC);
