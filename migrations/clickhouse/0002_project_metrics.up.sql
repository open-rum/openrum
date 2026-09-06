CREATE TABLE IF NOT EXISTS project_metrics_1m_local ON CLUSTER openrum_cluster
(
    project_id UUID,
    bucket DateTime('UTC'),
    environment LowCardinality(String),
    release String,
    route String,
    country FixedString(2),
    browser LowCardinality(String),
    device_type LowCardinality(String),

    page_view_events AggregateFunction(uniqCombined64, Nullable(UUID)),
    page_view_estimated AggregateFunction(sum, Float64),
    unique_users AggregateFunction(uniqCombined64, Nullable(String)),
    unique_sessions AggregateFunction(uniqCombined64, Nullable(UUID)),
    error_events AggregateFunction(uniqCombined64, Nullable(UUID)),
    error_estimated AggregateFunction(sum, Float64),
    api_requests AggregateFunction(uniqCombined64, Nullable(UUID)),
    api_estimated AggregateFunction(sum, Float64),
    api_failures AggregateFunction(uniqCombined64, Nullable(UUID)),

    lcp_p75 AggregateFunction(quantileTDigest(0.75), Nullable(Float64)),
    lcp_samples AggregateFunction(uniqCombined64, Nullable(UUID)),
    inp_p75 AggregateFunction(quantileTDigest(0.75), Nullable(Float64)),
    inp_samples AggregateFunction(uniqCombined64, Nullable(UUID)),
    cls_p75 AggregateFunction(quantileTDigest(0.75), Nullable(Float64)),
    cls_samples AggregateFunction(uniqCombined64, Nullable(UUID)),
    latest_received_at AggregateFunction(max, DateTime64(3, 'UTC'))
)
ENGINE = ReplicatedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY (toYYYYMM(bucket), project_id)
ORDER BY (project_id, bucket, environment, release, route, country, browser, device_type)
TTL bucket + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS project_metrics_1m ON CLUSTER openrum_cluster
AS project_metrics_1m_local
ENGINE = Distributed(
    'openrum_cluster',
    currentDatabase(),
    project_metrics_1m_local,
    cityHash64(project_id)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS project_metrics_1m_mv ON CLUSTER openrum_cluster
TO project_metrics_1m_local
AS
SELECT
    project_id,
    toStartOfMinute(timestamp) AS bucket,
    environment,
    release,
    route,
    country,
    browser,
    device_type,
    uniqCombined64State(if(event_type = 'page_view', toNullable(event_id), NULL)) AS page_view_events,
    sumState(if(event_type = 'page_view', 1.0 / greatest(toFloat64(sample_rate), 0.000001), 0.0)) AS page_view_estimated,
    uniqCombined64State(if(event_type = 'page_view', toNullable(anonymous_user_id), NULL)) AS unique_users,
    uniqCombined64State(if(event_type = 'page_view', toNullable(session_id), NULL)) AS unique_sessions,
    uniqCombined64State(if(event_type = 'error', toNullable(event_id), NULL)) AS error_events,
    sumState(if(event_type = 'error', 1.0 / greatest(toFloat64(sample_rate), 0.000001), 0.0)) AS error_estimated,
    uniqCombined64State(if(event_type = 'api', toNullable(event_id), NULL)) AS api_requests,
    sumState(if(event_type = 'api', 1.0 / greatest(toFloat64(sample_rate), 0.000001), 0.0)) AS api_estimated,
    uniqCombined64State(if(event_type = 'api' AND (api_failure != '' OR api_status >= 500), toNullable(event_id), NULL)) AS api_failures,
    quantileTDigestState(0.75)(if(metric_name = 'LCP', toNullable(metric_value), NULL)) AS lcp_p75,
    uniqCombined64State(if(metric_name = 'LCP', toNullable(event_id), NULL)) AS lcp_samples,
    quantileTDigestState(0.75)(if(metric_name = 'INP', toNullable(metric_value), NULL)) AS inp_p75,
    uniqCombined64State(if(metric_name = 'INP', toNullable(event_id), NULL)) AS inp_samples,
    quantileTDigestState(0.75)(if(metric_name = 'CLS', toNullable(metric_value), NULL)) AS cls_p75,
    uniqCombined64State(if(metric_name = 'CLS', toNullable(event_id), NULL)) AS cls_samples,
    maxState(received_at) AS latest_received_at
FROM rum_events_local
WHERE NOT has(ingest_flags, 'synthetic')
GROUP BY project_id, bucket, environment, release, route, country, browser, device_type;

CREATE TABLE IF NOT EXISTS api_metrics_1m_local ON CLUSTER openrum_cluster
(
    project_id UUID,
    bucket DateTime('UTC'),
    environment LowCardinality(String),
    release String,
    route String,
    api_method LowCardinality(String),
    api_url_normalized String,

    requests AggregateFunction(uniqCombined64, UUID),
    estimated AggregateFunction(sum, Float64),
    failures AggregateFunction(uniqCombined64, Nullable(UUID)),
    client_errors AggregateFunction(uniqCombined64, Nullable(UUID)),
    server_errors AggregateFunction(uniqCombined64, Nullable(UUID)),
    network_errors AggregateFunction(uniqCombined64, Nullable(UUID)),
    duration_p50 AggregateFunction(quantileTDigest(0.50), Float64),
    duration_p75 AggregateFunction(quantileTDigest(0.75), Float64),
    duration_p95 AggregateFunction(quantileTDigest(0.95), Float64)
)
ENGINE = ReplicatedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY (toYYYYMM(bucket), project_id)
ORDER BY (project_id, bucket, environment, release, route, api_method, api_url_normalized)
TTL bucket + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS api_metrics_1m ON CLUSTER openrum_cluster
AS api_metrics_1m_local
ENGINE = Distributed(
    'openrum_cluster',
    currentDatabase(),
    api_metrics_1m_local,
    cityHash64(project_id)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS api_metrics_1m_mv ON CLUSTER openrum_cluster
TO api_metrics_1m_local
AS
SELECT
    project_id,
    toStartOfMinute(timestamp) AS bucket,
    environment,
    release,
    route,
    api_method,
    api_url_normalized,
    uniqCombined64State(event_id) AS requests,
    sumState(1.0 / greatest(toFloat64(sample_rate), 0.000001)) AS estimated,
    uniqCombined64State(if(api_failure != '' OR api_status >= 500, toNullable(event_id), NULL)) AS failures,
    uniqCombined64State(if(api_status >= 400 AND api_status < 500, toNullable(event_id), NULL)) AS client_errors,
    uniqCombined64State(if(api_status >= 500, toNullable(event_id), NULL)) AS server_errors,
    uniqCombined64State(if(api_failure IN ('network', 'timeout', 'abort'), toNullable(event_id), NULL)) AS network_errors,
    quantileTDigestState(0.50)(duration_ms) AS duration_p50,
    quantileTDigestState(0.75)(duration_ms) AS duration_p75,
    quantileTDigestState(0.95)(duration_ms) AS duration_p95
FROM rum_events_local
WHERE event_type = 'api' AND NOT has(ingest_flags, 'synthetic')
GROUP BY project_id, bucket, environment, release, route, api_method, api_url_normalized;
