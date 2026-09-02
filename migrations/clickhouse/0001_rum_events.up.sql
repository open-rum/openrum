CREATE TABLE IF NOT EXISTS rum_events_local ON CLUSTER openrum_cluster
(
    project_id UUID,
    event_id UUID,
    event_type LowCardinality(String),
    timestamp DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
    received_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(Delta, ZSTD(3)),

    environment LowCardinality(String),
    release String CODEC(ZSTD(3)),
    dist LowCardinality(String),
    session_id UUID,
    anonymous_user_id String CODEC(ZSTD(3)),
    user_id String CODEC(ZSTD(3)),
    page_id UUID,

    page_url String CODEC(ZSTD(3)),
    page_url_normalized String CODEC(ZSTD(3)),
    route String CODEC(ZSTD(3)),
    referrer String CODEC(ZSTD(3)),
    title String CODEC(ZSTD(3)),
    navigation_type LowCardinality(String),

    sdk_name LowCardinality(String),
    sdk_version LowCardinality(String),
    schema_version LowCardinality(String),
    sample_rate Float32 DEFAULT 1,
    browser LowCardinality(String),
    browser_version LowCardinality(String),
    os LowCardinality(String),
    os_version LowCardinality(String),
    device_type LowCardinality(String),
    country FixedString(2),

    trace_id String,
    span_id String,

    error_type LowCardinality(String),
    error_message String CODEC(ZSTD(3)),
    error_stack String CODEC(ZSTD(3)),
    error_mechanism LowCardinality(String),
    fingerprint String,
    handled Bool,

    api_method LowCardinality(String),
    api_url_normalized String CODEC(ZSTD(3)),
    api_status UInt16,
    api_failure LowCardinality(String),
    duration_ms Float64,
    transfer_size UInt64,

    metric_name LowCardinality(String),
    metric_value Float64,
    metric_delta Float64,
    metric_rating LowCardinality(String),

    custom_name LowCardinality(String),
    attributes Map(String, String) CODEC(ZSTD(3)),
    measurements Map(String, Float64) CODEC(ZSTD(3)),
    breadcrumbs Array(String) CODEC(ZSTD(3)),
    ingest_flags Array(LowCardinality(String)) CODEC(ZSTD(3)),

    INDEX error_fingerprint_idx fingerprint TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX api_url_idx api_url_normalized TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', received_at)
PARTITION BY (toYYYYMM(timestamp), project_id)
ORDER BY (project_id, event_type, timestamp, event_id)
TTL timestamp + INTERVAL 14 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS rum_events ON CLUSTER openrum_cluster
AS rum_events_local
ENGINE = Distributed(
    'openrum_cluster',
    currentDatabase(),
    rum_events_local,
    cityHash64(project_id, session_id)
);
