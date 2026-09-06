CREATE TABLE IF NOT EXISTS behavior_metrics_1m_local ON CLUSTER openrum_cluster
(
    project_id UUID,
    bucket DateTime('UTC'),
    environment LowCardinality(String),
    event_kind LowCardinality(String),
    event_name LowCardinality(String),
    dimension LowCardinality(String),
    dimension_value String,

    events AggregateFunction(uniqCombined64, UUID),
    estimated AggregateFunction(sum, Float64),
    unique_users AggregateFunction(uniqCombined64, Nullable(String)),
    unique_sessions AggregateFunction(uniqCombined64, Nullable(UUID)),
    latest_received_at AggregateFunction(max, DateTime64(3, 'UTC'))
)
ENGINE = ReplicatedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY (toYYYYMM(bucket), project_id)
ORDER BY (project_id, bucket, environment, event_kind, event_name, dimension, dimension_value)
TTL bucket + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS behavior_metrics_1m ON CLUSTER openrum_cluster
AS behavior_metrics_1m_local
ENGINE = Distributed(
    'openrum_cluster',
    currentDatabase(),
    behavior_metrics_1m_local,
    cityHash64(project_id)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS behavior_metrics_1m_mv ON CLUSTER openrum_cluster
TO behavior_metrics_1m_local
AS
SELECT
    project_id,
    toStartOfMinute(timestamp) AS bucket,
    environment,
    multiIf(
        event_type = 'page_view' AND navigation_type = 'route_change', 'navigation',
        event_type = 'page_view', 'page_view',
        custom_name = 'ui.click', 'click',
        'custom'
    ) AS event_kind,
    if(event_type = 'custom' AND custom_name != 'ui.click', custom_name, event_kind) AS event_name,
    tupleElement(dimension_pair, 1) AS dimension,
    tupleElement(dimension_pair, 2) AS dimension_value,
    uniqCombined64State(event_id) AS events,
    sumState(1.0 / greatest(toFloat64(sample_rate), 0.000001)) AS estimated,
    uniqCombined64State(if(anonymous_user_id != '', toNullable(anonymous_user_id), NULL)) AS unique_users,
    uniqCombined64State(if(session_id != toUUID('00000000-0000-0000-0000-000000000000'), toNullable(session_id), NULL)) AS unique_sessions,
    maxState(received_at) AS latest_received_at
FROM rum_events_local
ARRAY JOIN arrayConcat(
    [
        tuple('all', 'all'),
        tuple('country', if(country = '', 'unknown', toString(country))),
        tuple('device', if(device_type = '', 'unknown', toString(device_type))),
        tuple('browser', if(browser = '', 'unknown', toString(browser))),
        tuple('source', if(domain(referrer) = '', 'direct', domain(referrer)))
    ],
    if(
        event_type = 'custom',
        arrayMap((key, value) -> tuple(concat('property:', key), value), mapKeys(attributes), mapValues(attributes)),
        []
    )
) AS dimension_pair
WHERE event_type IN ('page_view', 'custom') AND NOT has(ingest_flags, 'synthetic')
GROUP BY project_id, bucket, environment, event_kind, event_name, dimension, dimension_value;
