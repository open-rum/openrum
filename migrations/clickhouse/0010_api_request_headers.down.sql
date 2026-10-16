ALTER TABLE rum_events ON CLUSTER openrum_cluster DROP COLUMN IF EXISTS api_response_headers;
ALTER TABLE rum_events ON CLUSTER openrum_cluster DROP COLUMN IF EXISTS api_request_headers;
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster DROP COLUMN IF EXISTS api_response_headers;
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster DROP COLUMN IF EXISTS api_request_headers;
