-- Numeric Custom Event measurements, aggregated.
--
-- `measurements` reached ClickHouse as a Map on the Event and could only ever be read
-- one Event at a time, so "total revenue" and "average order value" had no query. This
-- table is the aggregate that answers them.
--
-- It is a separate table rather than columns on `behavior_metrics_1m` because the
-- measurement key is a grouping key of its own: folding it in would multiply every
-- existing behavior row by the number of measurements on the Event, including the
-- Page Views that carry none.
--
-- Volume is bounded on three sides. Only Custom Events reach it (`measurements` is
-- populated in no other branch of normalization), only those that actually carry a
-- measurement, and Ingest already caps an Event at 20 measurements and 20 attributes.
-- Rows per Event are therefore measurements x (5 + attributes), and the aggregate is
-- empty for a Project that sends no measurements at all.
CREATE TABLE IF NOT EXISTS measurement_metrics_1m_local ON CLUSTER openrum_cluster
(
    project_id UUID,
    bucket DateTime('UTC'),
    environment LowCardinality(String),
    event_name LowCardinality(String),
    measurement LowCardinality(String),
    dimension LowCardinality(String),
    dimension_value String,

    samples AggregateFunction(count),
    -- `total` is what was stored; `estimated` divides by the Event's sample rate, which
    -- is the only one of the two that means anything once sampling is below 1.
    total AggregateFunction(sum, Float64),
    estimated AggregateFunction(sum, Float64),
    minimum AggregateFunction(min, Float64),
    maximum AggregateFunction(max, Float64),
    -- Monetary values are skewed, so a mean alone misleads. Carrying the digest from the
    -- start costs one column now and avoids a second migration plus a MODIFY QUERY later.
    quantiles AggregateFunction(quantilesTDigest(0.5, 0.9), Float64),
    latest_received_at AggregateFunction(max, DateTime64(3, 'UTC')),
    aggregate_expires_at SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
        DEFAULT toDateTime64(bucket, 3, 'UTC') + toIntervalDay(90)
)
ENGINE = ReplicatedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY (toYYYYMM(bucket), project_id)
ORDER BY (project_id, bucket, environment, event_name, measurement, dimension, dimension_value)
TTL aggregate_expires_at DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS measurement_metrics_1m ON CLUSTER openrum_cluster
AS measurement_metrics_1m_local
ENGINE = Distributed(
    'openrum_cluster',
    currentDatabase(),
    measurement_metrics_1m_local,
    cityHash64(project_id)
);

-- The ARRAY JOIN is a deliberate cross product of measurement keys and dimensions.
-- Listing two arrays in one ARRAY JOIN zips them in lockstep instead, which would pair
-- the first measurement with the first dimension and silently lose every other
-- combination, so the product is built as one nested array before it is joined.
CREATE MATERIALIZED VIEW IF NOT EXISTS measurement_metrics_1m_mv ON CLUSTER openrum_cluster
TO measurement_metrics_1m_local
AS
SELECT
    project_id,
    toStartOfMinute(timestamp) AS bucket,
    environment,
    if(custom_name != 'ui.click', custom_name, 'click') AS event_name,
    tupleElement(measurement_row, 1) AS measurement,
    tupleElement(measurement_row, 3) AS dimension,
    tupleElement(measurement_row, 4) AS dimension_value,
    countState() AS samples,
    sumState(tupleElement(measurement_row, 2)) AS total,
    sumState(tupleElement(measurement_row, 2) / greatest(toFloat64(sample_rate), 0.000001)) AS estimated,
    minState(tupleElement(measurement_row, 2)) AS minimum,
    maxState(tupleElement(measurement_row, 2)) AS maximum,
    quantilesTDigestState(0.5, 0.9)(tupleElement(measurement_row, 2)) AS quantiles,
    maxState(received_at) AS latest_received_at,
    max(aggregate_expires_at) AS aggregate_expires_at
FROM rum_events_local
ARRAY JOIN arrayFlatten(
    arrayMap(
        key -> arrayMap(
            pair -> tuple(key, measurements[key], tupleElement(pair, 1), tupleElement(pair, 2)),
            arrayConcat(
                [
                    tuple('all', 'all'),
                    tuple('country', if(country = '', 'unknown', toString(country))),
                    tuple('device', if(device_type = '', 'unknown', toString(device_type))),
                    tuple('browser', if(browser = '', 'unknown', toString(browser))),
                    tuple('source', if(domain(referrer) = '', 'direct', domain(referrer)))
                ],
                arrayMap((key, value) -> tuple(concat('property:', key), value), mapKeys(attributes), mapValues(attributes))
            )
        ),
        mapKeys(measurements)
    )
) AS measurement_row
WHERE event_type = 'custom' AND notEmpty(measurements) AND NOT has(ingest_flags, 'synthetic')
GROUP BY project_id, bucket, environment, event_name, measurement, dimension, dimension_value;
