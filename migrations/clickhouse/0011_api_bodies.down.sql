ALTER TABLE rum_events ON CLUSTER openrum_cluster DROP COLUMN IF EXISTS api_response_body;
ALTER TABLE rum_events ON CLUSTER openrum_cluster DROP COLUMN IF EXISTS api_request_body;
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster DROP COLUMN IF EXISTS api_response_body;
ALTER TABLE rum_events_local ON CLUSTER openrum_cluster DROP COLUMN IF EXISTS api_request_body;
