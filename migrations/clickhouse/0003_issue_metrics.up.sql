ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
  ADD COLUMN IF NOT EXISTS fingerprint_version UInt16 AFTER fingerprint;

ALTER TABLE rum_events ON CLUSTER openrum_cluster
  ADD COLUMN IF NOT EXISTS fingerprint_version UInt16 AFTER fingerprint;

CREATE TABLE IF NOT EXISTS issue_metrics_5m_local ON CLUSTER openrum_cluster
(
    project_id UUID,
    bucket DateTime('UTC'),
    environment LowCardinality(String),
    release String,
    route String,
    browser LowCardinality(String),
    device_type LowCardinality(String),
    country FixedString(2),
    fingerprint String,
    fingerprint_version UInt16,
    events AggregateFunction(uniqCombined64, UUID),
    users AggregateFunction(uniqCombined64, Nullable(String)),
    sessions AggregateFunction(uniqCombined64, Nullable(UUID)),
    first_seen AggregateFunction(min, DateTime64(3, 'UTC')),
    last_seen AggregateFunction(max, DateTime64(3, 'UTC')),
    error_type AggregateFunction(argMax, String, DateTime64(3, 'UTC')),
    error_message AggregateFunction(argMax, String, DateTime64(3, 'UTC'))
)
ENGINE = ReplicatedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY (toYYYYMM(bucket), project_id)
ORDER BY (project_id, bucket, environment, release, route, fingerprint, browser, device_type, country)
TTL bucket + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS issue_metrics_5m ON CLUSTER openrum_cluster
AS issue_metrics_5m_local
ENGINE = Distributed(
    'openrum_cluster',
    currentDatabase(),
    issue_metrics_5m_local,
    cityHash64(project_id, fingerprint)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS issue_metrics_5m_mv ON CLUSTER openrum_cluster
TO issue_metrics_5m_local
AS
SELECT
    project_id,
    toStartOfInterval(timestamp, INTERVAL 5 MINUTE) AS bucket,
    environment,
    release,
    route,
    browser,
    device_type,
    country,
    fingerprint,
    fingerprint_version,
    uniqCombined64State(event_id) AS events,
    uniqCombined64State(if(anonymous_user_id = '', NULL, toNullable(anonymous_user_id))) AS users,
    uniqCombined64State(toNullable(session_id)) AS sessions,
    minState(timestamp) AS first_seen,
    maxState(timestamp) AS last_seen,
    argMaxState(error_type, timestamp) AS error_type,
    argMaxState(error_message, timestamp) AS error_message
FROM rum_events_local
WHERE event_type = 'error' AND fingerprint != '' AND NOT has(ingest_flags, 'synthetic')
GROUP BY project_id, bucket, environment, release, route, browser, device_type, country, fingerprint, fingerprint_version;
