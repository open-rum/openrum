-- Several named, personal dashboards per user and Project. They remain personal
-- preferences, not Project settings: a Project data purge keeps them (ADR 0007).
CREATE TABLE user_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
  -- The position range is the per-user limit: twenty dashboards, enforced by the schema.
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 19),
  config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (octet_length(config::text) <= 65536),
  -- Deferrable so a reorder can swap positions inside one transaction.
  CONSTRAINT user_dashboards_position_key UNIQUE (user_id, project_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE UNIQUE INDEX user_dashboards_name_key ON user_dashboards (user_id, project_id, lower(name));
CREATE INDEX user_dashboards_project_idx ON user_dashboards (project_id);

-- Carry every existing layout over as the user's first dashboard. The revision is kept
-- so a tab still open on the old endpoint saves against the same version.
INSERT INTO user_dashboards (user_id, project_id, name, position, config, revision, created_at, updated_at)
SELECT user_id, project_id, '我的仪表盘', 0, config, revision, updated_at, updated_at
FROM user_project_dashboards;

-- Kept for one release so a rollback loses nothing; a later migration drops it.
COMMENT ON TABLE user_project_dashboards IS 'Superseded by user_dashboards (0023). Kept for rollback only.';
