CREATE TABLE instance_secrets (
  name VARCHAR(64) PRIMARY KEY,
  encrypted_value BYTEA NOT NULL CHECK (octet_length(encrypted_value) BETWEEN 32 AND 32768),
  key_id VARCHAR(32) NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
