ALTER TABLE project_deletions DROP COLUMN IF EXISTS empty_since;
ALTER TABLE project_deletions DROP CONSTRAINT project_deletions_status_check;
ALTER TABLE project_deletions
  ADD CONSTRAINT project_deletions_status_check
  CHECK (status IN ('queued', 'running', 'retry', 'completed', 'failed'));
