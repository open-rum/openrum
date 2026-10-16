-- Per-project opt-in rules for storing HTTP headers on API Requests. An empty
-- object means no rule, and a project with no rule stores no header: capture is
-- off until somebody names an endpoint.
ALTER TABLE projects
  ADD COLUMN api_capture_rules JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(api_capture_rules) = 'object');
