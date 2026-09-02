CREATE TABLE IF NOT EXISTS openrum_foundation (version UInt64, applied_at DateTime64(3)) ENGINE = MergeTree ORDER BY version
