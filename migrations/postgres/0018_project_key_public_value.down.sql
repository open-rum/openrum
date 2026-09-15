ALTER TABLE project_keys
  DROP CONSTRAINT IF EXISTS project_keys_public_key_unique,
  DROP CONSTRAINT IF EXISTS project_keys_public_key_format_check,
  DROP COLUMN IF EXISTS public_key;
