-- Rolling back keeps each user's first dashboard and loses the rest: the previous schema
-- holds exactly one per user and Project.
INSERT INTO user_project_dashboards (user_id, project_id, config, revision, updated_at)
SELECT DISTINCT ON (user_id, project_id) user_id, project_id, config, revision, updated_at
FROM user_dashboards
ORDER BY user_id, project_id, position
ON CONFLICT (user_id, project_id) DO UPDATE
SET config = EXCLUDED.config,
    revision = GREATEST(user_project_dashboards.revision, EXCLUDED.revision) + 1,
    updated_at = now();

COMMENT ON TABLE user_project_dashboards IS NULL;
DROP TABLE user_dashboards;
