CREATE TABLE IF NOT EXISTS event_stack_mappings_local ON CLUSTER openrum_cluster
(
    project_id UUID,
    event_id UUID,
    status LowCardinality(String),
    failure_code LowCardinality(String),
    mapped_stack String CODEC(ZSTD(3)),
    mapped_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(Delta, ZSTD(3))
)
ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', mapped_at)
PARTITION BY (toYYYYMM(mapped_at), project_id)
ORDER BY (project_id, event_id)
TTL mapped_at + INTERVAL 90 DAY DELETE;

CREATE TABLE IF NOT EXISTS event_stack_mappings ON CLUSTER openrum_cluster
AS event_stack_mappings_local
ENGINE = Distributed(
    'openrum_cluster',
    currentDatabase(),
    event_stack_mappings_local,
    cityHash64(project_id, event_id)
);
