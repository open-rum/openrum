DROP TABLE IF EXISTS instance_audit_logs;
ALTER TABLE sessions DROP COLUMN IF EXISTS elevated_at;
