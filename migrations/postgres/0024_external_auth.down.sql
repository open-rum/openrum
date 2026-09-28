-- Refuse rollback after external authentication data has been created.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth_providers)
     OR EXISTS (SELECT 1 FROM auth_identities)
     OR EXISTS (SELECT 1 FROM users WHERE access_status <> 'approved'
       OR auth_source NOT IN ('local', 'oidc')
       OR (auth_source = 'oidc' AND password_hash IS NOT NULL)) THEN
    RAISE EXCEPTION 'external authentication data must be migrated before rolling back 0024';
  END IF;
END $$;

DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS auth_providers;
ALTER TABLE users DROP COLUMN IF EXISTS access_status;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_local_password_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_source_check;
ALTER TABLE users ADD CONSTRAINT users_auth_source_check
  CHECK (auth_source IN ('local', 'oidc'));
ALTER TABLE users ADD CONSTRAINT users_check CHECK (
  (auth_source = 'local' AND password_hash IS NOT NULL AND oidc_subject IS NULL)
  OR (auth_source = 'oidc' AND password_hash IS NULL AND oidc_subject IS NOT NULL)
);
