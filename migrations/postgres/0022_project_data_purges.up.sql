CREATE TABLE project_data_purges (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry', 'verifying', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  last_error VARCHAR(512) NOT NULL DEFAULT '',
  empty_since TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (completed_at IS NULL OR status = 'completed')
);

CREATE INDEX project_data_purges_pending_idx
  ON project_data_purges (next_attempt_at, created_at)
  WHERE status IN ('queued', 'running', 'retry', 'verifying');
