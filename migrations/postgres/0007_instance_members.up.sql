CREATE TABLE instance_members (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(24) NOT NULL CHECK (role IN ('instance_owner', 'instance_admin')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX instance_members_role_user_idx
  ON instance_members (role, user_id);

-- Preserve access for upgraded installations. Prefer the earliest organization
-- owner, then fall back to the earliest user if legacy data is incomplete.
WITH initial_owner AS (
  SELECT users.id
  FROM users
  LEFT JOIN organization_members
    ON organization_members.user_id = users.id
   AND organization_members.role = 'owner'
  ORDER BY (organization_members.user_id IS NOT NULL) DESC, users.created_at, users.id
  LIMIT 1
)
INSERT INTO instance_members (user_id, role, created_by)
SELECT id, 'instance_owner', id FROM initial_owner;
