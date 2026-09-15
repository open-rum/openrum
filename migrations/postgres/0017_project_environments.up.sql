CREATE TABLE project_environments (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{0,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, name)
);

INSERT INTO project_environments (project_id, name)
SELECT id, environment
FROM projects
ON CONFLICT (project_id, name) DO NOTHING;

