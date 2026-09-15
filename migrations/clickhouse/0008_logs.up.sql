ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS log_level LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS log_message String DEFAULT '',
    ADD COLUMN IF NOT EXISTS log_logger LowCardinality(String) DEFAULT '';

ALTER TABLE rum_events ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS log_level LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS log_message String DEFAULT '',
    ADD COLUMN IF NOT EXISTS log_logger LowCardinality(String) DEFAULT '';
