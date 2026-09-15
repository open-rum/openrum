CREATE TABLE user_project_dashboards (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id),
  CHECK (octet_length(config::text) <= 65536)
);

CREATE INDEX user_project_dashboards_project_idx ON user_project_dashboards (project_id);
