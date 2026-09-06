ALTER TABLE projects
  ADD COLUMN sdk_config_version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN sdk_config_effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN emergency_sample_rate DOUBLE PRECISION,
  ADD COLUMN emergency_expires_at TIMESTAMPTZ,
  ADD CONSTRAINT projects_emergency_sample_rate_check
    CHECK (emergency_sample_rate IS NULL OR emergency_sample_rate BETWEEN 0 AND 1),
  ADD CONSTRAINT projects_emergency_pair_check
    CHECK ((emergency_sample_rate IS NULL) = (emergency_expires_at IS NULL));
