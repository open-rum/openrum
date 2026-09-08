-- Empty objects mean no project-defined rewriting, so existing projects keep
-- behaving exactly as they did: the built-in identifier heuristics and the
-- built-in redaction patterns remain the only ones that run until somebody
-- opts in.
ALTER TABLE projects
  ADD COLUMN url_rules JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(url_rules) = 'object'),
  ADD COLUMN scrub_rules JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(scrub_rules) = 'object');
