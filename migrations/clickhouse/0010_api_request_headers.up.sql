-- HTTP header snapshots on API Requests, stored only for endpoints a project opted in to.
--
-- They are bounded maps (at most 20 names, 256 bytes per value) and are empty for every
-- row of a project that never turned capture on.
--
-- The column TTL is deliberately shorter than the row's: a header can carry something the
-- project did not foresee, so the snapshot is cleared three days after the request while
-- the row itself lives for the project's retention. ClickHouse applies a column TTL during
-- merges, not at the instant it expires, so the query layer also hides a snapshot older
-- than three days (internal/capture.RetentionDays).
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS api_request_headers Map(String, String) CODEC(ZSTD(3))
        TTL timestamp + toIntervalDay(3);
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS api_response_headers Map(String, String) CODEC(ZSTD(3))
        TTL timestamp + toIntervalDay(3);
ALTER TABLE rum_events ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS api_request_headers Map(String, String) CODEC(ZSTD(3));
ALTER TABLE rum_events ON CLUSTER openrum_cluster
    ADD COLUMN IF NOT EXISTS api_response_headers Map(String, String) CODEC(ZSTD(3));
