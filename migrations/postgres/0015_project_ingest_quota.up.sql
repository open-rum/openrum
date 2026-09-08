-- NULL means the instance default applies, so existing projects keep the
-- behaviour they had while the limit was a constant in the binary. The default
-- behaviour is the one that was already in force: over the limit, the request
-- is refused.
ALTER TABLE projects
  ADD COLUMN ingest_rate_limit INTEGER
    CHECK (ingest_rate_limit IS NULL OR ingest_rate_limit BETWEEN 1 AND 1000000),
  ADD COLUMN over_limit_behavior TEXT NOT NULL DEFAULT 'reject'
    CHECK (over_limit_behavior IN ('reject', 'sample'));
