-- When an Issue was last marked resolved. An Issue that fails again after this time is
-- shown as a regression; the stored status stays "resolved" until someone changes it.
ALTER TABLE issue_states ADD COLUMN resolved_at TIMESTAMPTZ;
UPDATE issue_states SET resolved_at = updated_at WHERE status = 'resolved';
