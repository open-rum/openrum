-- Self-service password reset links. Only the SHA-256 of the emailed secret is stored, and
-- each account holds at most one active link so requesting another invalidates the first.
CREATE TABLE password_resets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
