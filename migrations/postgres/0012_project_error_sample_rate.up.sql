ALTER TABLE projects
  ADD COLUMN error_sample_rate DOUBLE PRECISION NOT NULL DEFAULT 1
    CHECK (error_sample_rate BETWEEN 0 AND 1);
