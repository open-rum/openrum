ALTER TABLE projects
  DROP COLUMN IF EXISTS ingest_rate_limit,
  DROP COLUMN IF EXISTS over_limit_behavior;
