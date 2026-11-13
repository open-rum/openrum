-- The currency the Console labels revenue with. It is a display label only: amounts are
-- stored as reported and never converted. An empty string means none was chosen, and the
-- Console shows plain numbers.
ALTER TABLE projects ADD COLUMN revenue_currency VARCHAR(3) NOT NULL DEFAULT ''
  CHECK (revenue_currency = '' OR revenue_currency ~ '^[A-Z]{3}$');
