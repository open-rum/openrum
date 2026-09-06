CREATE TABLE notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('smtp', 'webhook')),
  encrypted_config BYTEA NOT NULL CHECK (octet_length(encrypted_config) BETWEEN 32 AND 16384),
  encryption_key_id VARCHAR(120) NOT NULL CHECK (char_length(encryption_key_id) BETWEEN 1 AND 120),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX notification_channels_organization_idx
  ON notification_channels (organization_id, enabled, created_at DESC);

CREATE TABLE alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  metric VARCHAR(32) NOT NULL CHECK (metric IN ('error_count', 'error_rate', 'api_failure_rate', 'lcp_p75')),
  comparator VARCHAR(4) NOT NULL DEFAULT 'gte' CHECK (comparator IN ('gt', 'gte')),
  threshold DOUBLE PRECISION NOT NULL CHECK (threshold >= 0 AND threshold < 1000000000000),
  window_minutes SMALLINT NOT NULL CHECK (window_minutes IN (5, 10, 15, 30, 60)),
  cooldown_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (cooldown_minutes BETWEEN 5 AND 1440),
  environment VARCHAR(64) NOT NULL DEFAULT '' CHECK (environment = '' OR environment ~ '^[a-z][a-z0-9_-]{0,63}$'),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX alert_rules_project_enabled_idx ON alert_rules (project_id, enabled);

CREATE TABLE alert_rule_channels (
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, channel_id)
);

CREATE TABLE alert_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL,
  window_ended_at TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION,
  status VARCHAR(16) NOT NULL CHECK (status IN ('ok', 'breached', 'suppressed', 'failed')),
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  CHECK (window_started_at < window_ended_at),
  UNIQUE (rule_id, window_started_at, window_ended_at)
);

CREATE INDEX alert_evaluations_rule_time_idx
  ON alert_evaluations (rule_id, window_ended_at DESC);
