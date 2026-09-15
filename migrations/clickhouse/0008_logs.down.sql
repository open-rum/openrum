ALTER TABLE rum_events ON CLUSTER openrum_cluster
    DROP COLUMN IF EXISTS log_level,
    DROP COLUMN IF EXISTS log_message,
    DROP COLUMN IF EXISTS log_logger;

ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
    DROP COLUMN IF EXISTS log_level,
    DROP COLUMN IF EXISTS log_message,
    DROP COLUMN IF EXISTS log_logger;
