-- Invitation links and the join requests they produce. A link only gives its
-- holder the right to ask: nothing here grants access until an Owner or Admin
-- approves a request. Only the SHA-256 of the link's secret is stored; the
-- plaintext is shown once when the invitation is created.
CREATE TABLE organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  -- Where the link was mailed. It is a record, not a restriction.
  email CITEXT CHECK (email IS NULL OR char_length(email) <= 320),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX organization_invitations_organization_idx
  ON organization_invitations (organization_id, created_at DESC);

CREATE TABLE organization_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invitation_id UUID REFERENCES organization_invitations(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ
);

-- One open request per person and organization; decided ones stay as history.
CREATE UNIQUE INDEX organization_join_requests_pending_unique
  ON organization_join_requests (organization_id, user_id) WHERE status = 'pending';
CREATE INDEX organization_join_requests_organization_idx
  ON organization_join_requests (organization_id, status, created_at DESC);
CREATE INDEX organization_join_requests_user_idx
  ON organization_join_requests (user_id) WHERE status = 'pending';
