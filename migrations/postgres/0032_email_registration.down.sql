DROP INDEX IF EXISTS users_unverified_created_idx;
DROP TABLE IF EXISTS email_verifications;
DELETE FROM users WHERE access_status = 'unverified';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_access_status_check;
ALTER TABLE users ADD CONSTRAINT users_access_status_check
  CHECK (access_status IN ('approved', 'pending'));
