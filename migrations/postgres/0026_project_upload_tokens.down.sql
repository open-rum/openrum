-- Rolling back invalidates every upload token; pipelines must fall back to a
-- Console session until the tokens are recreated.
DROP TABLE IF EXISTS project_upload_tokens;
