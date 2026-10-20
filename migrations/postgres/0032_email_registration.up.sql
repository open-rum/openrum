-- Open self-registration by email. An account made this way is 'unverified' until its owner
-- opens the link mailed to them: it cannot sign in and belongs to no organization. Only the
-- SHA-256 of the link's secret is stored, and each account has at most one live link, so
-- asking for another replaces the first.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_access_status_check;
ALTER TABLE users ADD CONSTRAINT users_access_status_check
  CHECK (access_status IN ('approved', 'pending', 'unverified'));

CREATE TABLE email_verifications (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Accounts nobody verified are removed after a week; this keeps that sweep cheap.
CREATE INDEX users_unverified_created_idx ON users (created_at) WHERE access_status = 'unverified';
