-- Redacted, size-limited HTTP body snapshots on API Requests, stored only for endpoints a
-- project opted in to (internal/capture). Empty for every row of a project that never turned
-- body capture on, and for every row whose rule did not name that direction.
--
-- Like the header snapshots in 0010, the column TTL is shorter than the row's: the snapshot is
-- cleared three days after the request while the row lives for the project's retention.
-- ClickHouse applies a column TTL during merges, so the query layer also hides a body older
-- than three days (internal/capture.RetentionDays).
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS api_request_body String CODEC(ZSTD(3))
        TTL timestamp + toIntervalDay(3);
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS api_response_body String CODEC(ZSTD(3))
        TTL timestamp + toIntervalDay(3);
ALTER TABLE rum_events ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS api_request_body String CODEC(ZSTD(3));
ALTER TABLE rum_events ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS api_response_body String CODEC(ZSTD(3));
