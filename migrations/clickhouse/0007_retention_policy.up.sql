ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS raw_expires_at DateTime64(3, 'UTC')
        DEFAULT timestamp + toIntervalDay(14) AFTER received_at;
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at DateTime64(3, 'UTC')
        DEFAULT timestamp + toIntervalDay(90) AFTER raw_expires_at;
ALTER TABLE rum_events ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS raw_expires_at DateTime64(3, 'UTC')
        DEFAULT timestamp + toIntervalDay(14) AFTER received_at;
ALTER TABLE rum_events ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at DateTime64(3, 'UTC')
        DEFAULT timestamp + toIntervalDay(90) AFTER raw_expires_at;
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
    MODIFY TTL raw_expires_at DELETE;

ALTER TABLE project_metrics_1m_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
        DEFAULT toDateTime64(bucket, 3, 'UTC') + toIntervalDay(90);
ALTER TABLE project_metrics_1m ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
        DEFAULT toDateTime64(bucket, 3, 'UTC') + toIntervalDay(90);
ALTER TABLE project_metrics_1m_local ON CLUSTER openrum_cluster
    MODIFY TTL aggregate_expires_at DELETE;

ALTER TABLE api_metrics_1m_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
        DEFAULT toDateTime64(bucket, 3, 'UTC') + toIntervalDay(90);
ALTER TABLE api_metrics_1m ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
        DEFAULT toDateTime64(bucket, 3, 'UTC') + toIntervalDay(90);
ALTER TABLE api_metrics_1m_local ON CLUSTER openrum_cluster
    MODIFY TTL aggregate_expires_at DELETE;

ALTER TABLE issue_metrics_5m_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
        DEFAULT toDateTime64(bucket, 3, 'UTC') + toIntervalDay(90);
ALTER TABLE issue_metrics_5m ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
        DEFAULT toDateTime64(bucket, 3, 'UTC') + toIntervalDay(90);
ALTER TABLE issue_metrics_5m_local ON CLUSTER openrum_cluster
    MODIFY TTL aggregate_expires_at DELETE;

ALTER TABLE behavior_metrics_1m_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
        DEFAULT toDateTime64(bucket, 3, 'UTC') + toIntervalDay(90);
ALTER TABLE behavior_metrics_1m ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS aggregate_expires_at SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
        DEFAULT toDateTime64(bucket, 3, 'UTC') + toIntervalDay(90);
ALTER TABLE behavior_metrics_1m_local ON CLUSTER openrum_cluster
    MODIFY TTL aggregate_expires_at DELETE;

ALTER TABLE project_metrics_1m_mv ON CLUSTER openrum_cluster MODIFY QUERY
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
    maxState(received_at) AS latest_received_at,
    max(aggregate_expires_at) AS aggregate_expires_at
FROM rum_events_local
WHERE NOT has(ingest_flags, 'synthetic')
GROUP BY project_id, bucket, environment, release, route, country, browser, device_type;

ALTER TABLE api_metrics_1m_mv ON CLUSTER openrum_cluster MODIFY QUERY
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
    quantileTDigestState(0.95)(duration_ms) AS duration_p95,
    max(aggregate_expires_at) AS aggregate_expires_at
FROM rum_events_local
WHERE event_type = 'api' AND NOT has(ingest_flags, 'synthetic')
GROUP BY project_id, bucket, environment, release, route, api_method, api_url_normalized;

ALTER TABLE issue_metrics_5m_mv ON CLUSTER openrum_cluster MODIFY QUERY
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
    argMaxState(error_message, timestamp) AS error_message,
    max(aggregate_expires_at) AS aggregate_expires_at
FROM rum_events_local
WHERE event_type = 'error' AND fingerprint != '' AND NOT has(ingest_flags, 'synthetic')
GROUP BY project_id, bucket, environment, release, route, browser, device_type, country, fingerprint, fingerprint_version;

ALTER TABLE behavior_metrics_1m_mv ON CLUSTER openrum_cluster MODIFY QUERY
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
    maxState(received_at) AS latest_received_at,
    max(aggregate_expires_at) AS aggregate_expires_at
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
