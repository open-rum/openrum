ALTER TABLE project_keys
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;

WITH ranked_keys AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY project_id
           ORDER BY (revoked_at IS NULL) DESC, created_at, id
         ) AS position
  FROM project_keys
  WHERE revoked_at IS NULL
)
UPDATE project_keys
SET is_default = true
FROM ranked_keys
WHERE project_keys.id = ranked_keys.id
  AND ranked_keys.position = 1;

CREATE UNIQUE INDEX project_keys_one_default_per_project_idx
  ON project_keys (project_id)
  WHERE is_default;

COMMENT ON COLUMN project_keys.is_default IS
  'The primary DSN shown in normal project setup; additional keys are advanced configuration.';
