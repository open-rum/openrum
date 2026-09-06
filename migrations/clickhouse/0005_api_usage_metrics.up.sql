-- API aggregates were introduced in 0002_project_metrics. This migration adds
-- the durable, bounded-outcome ledger used to reconcile ingest and storage usage.
CREATE TABLE IF NOT EXISTS usage_records_local ON CLUSTER openrum_cluster
(
    project_id UUID,
    record_id UUID,
    occurred_at DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
    recorded_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(Delta, ZSTD(3)),
    event_type LowCardinality(String),
    outcome LowCardinality(String),
    reason LowCardinality(String),
    event_count UInt64,
    estimated_count Float64,
    payload_bytes UInt64
)
ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', recorded_at)
PARTITION BY (toYYYYMM(occurred_at), project_id)
ORDER BY (project_id, occurred_at, outcome, event_type, reason, record_id)
TTL occurred_at + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS usage_records ON CLUSTER openrum_cluster
AS usage_records_local
ENGINE = Distributed(
    'openrum_cluster',
    currentDatabase(),
    usage_records_local,
    cityHash64(project_id, record_id)
);

CREATE TABLE IF NOT EXISTS usage_metrics_1h_local ON CLUSTER openrum_cluster
(
    project_id UUID,
    bucket DateTime('UTC'),
    event_type LowCardinality(String),
    outcome LowCardinality(String),
    reason LowCardinality(String),
    events AggregateFunction(sum, UInt64),
    estimated AggregateFunction(sum, Float64),
    bytes AggregateFunction(sum, UInt64)
)
ENGINE = ReplicatedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY (toYYYYMM(bucket), project_id)
ORDER BY (project_id, bucket, outcome, event_type, reason)
TTL bucket + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS usage_metrics_1h ON CLUSTER openrum_cluster
AS usage_metrics_1h_local
ENGINE = Distributed(
    'openrum_cluster',
    currentDatabase(),
    usage_metrics_1h_local,
    cityHash64(project_id)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS usage_metrics_1h_mv ON CLUSTER openrum_cluster
TO usage_metrics_1h_local
AS
SELECT
    project_id,
    toStartOfHour(occurred_at) AS bucket,
    event_type,
    outcome,
    reason,
    sumState(event_count) AS events,
    sumState(estimated_count) AS estimated,
    sumState(payload_bytes) AS bytes
FROM usage_records_local
WHERE outcome IN ('accepted', 'sampled', 'rejected', 'failed')
  AND reason IN ('', 'client_sample', 'invalid_event', 'rate_limited', 'queue_unavailable', 'normalize_failed', 'storage_failed', 'other')
GROUP BY project_id, bucket, event_type, outcome, reason;
