DROP INDEX IF EXISTS project_keys_one_default_per_project_idx;

ALTER TABLE project_keys
  DROP COLUMN IF EXISTS is_default;
