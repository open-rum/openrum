ALTER TABLE projects
  DROP COLUMN IF EXISTS url_rules,
  DROP COLUMN IF EXISTS scrub_rules;
