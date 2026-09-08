-- An empty object means no filtering, so existing projects keep behaving
-- exactly as they did: nothing is dropped until somebody opts in.
ALTER TABLE projects
  ADD COLUMN inbound_filters JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(inbound_filters) = 'object');
