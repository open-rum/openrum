ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_emergency_pair_check,
  DROP CONSTRAINT IF EXISTS projects_emergency_sample_rate_check,
  DROP COLUMN IF EXISTS emergency_expires_at,
  DROP COLUMN IF EXISTS emergency_sample_rate,
  DROP COLUMN IF EXISTS sdk_config_effective_at,
  DROP COLUMN IF EXISTS sdk_config_version;
