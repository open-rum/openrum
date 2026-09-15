ALTER TABLE project_keys
  ADD COLUMN public_key VARCHAR(128);

ALTER TABLE project_keys
  ADD CONSTRAINT project_keys_public_key_format_check
  CHECK (public_key IS NULL OR public_key ~ '^orr_pk_[A-Za-z0-9_-]+$'),
  ADD CONSTRAINT project_keys_public_key_unique UNIQUE (public_key);

COMMENT ON COLUMN project_keys.public_key IS
  'Browser-public ingest credential retained so authorized Console users can copy the DSN again.';
