ALTER TABLE project_deletions DROP CONSTRAINT project_deletions_status_check;
ALTER TABLE project_deletions
  ADD CONSTRAINT project_deletions_status_check
  CHECK (status IN ('queued', 'running', 'retry', 'verifying', 'completed', 'failed'));
ALTER TABLE project_deletions ADD COLUMN empty_since TIMESTAMPTZ;
