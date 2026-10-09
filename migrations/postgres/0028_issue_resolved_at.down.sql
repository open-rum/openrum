-- Rolling back forgets resolution times; resolved Issues no longer show as regressions.
ALTER TABLE issue_states DROP COLUMN IF EXISTS resolved_at;
