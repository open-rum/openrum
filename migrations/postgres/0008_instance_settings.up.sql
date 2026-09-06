CREATE TABLE instance_settings (
  namespace VARCHAR(64) NOT NULL,
  key VARCHAR(64) NOT NULL,
  value_json JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  source VARCHAR(24) NOT NULL DEFAULT 'instance' CHECK (source = 'instance'),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, key),
  CHECK (namespace ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CHECK (key ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$')
);

CREATE INDEX instance_settings_updated_at_idx
  ON instance_settings (updated_at DESC);
