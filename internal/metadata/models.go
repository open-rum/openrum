package metadata

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type UserStatus string
type AuthSource string
type OrganizationRole string
type InstanceRole string
type ProjectStatus string

const (
	UserStatusActive   UserStatus = "active"
	UserStatusDisabled UserStatus = "disabled"

	AuthSourceLocal AuthSource = "local"
	AuthSourceOIDC  AuthSource = "oidc"

	RoleOwner  OrganizationRole = "owner"
	RoleAdmin  OrganizationRole = "admin"
	RoleMember OrganizationRole = "member"
	RoleViewer OrganizationRole = "viewer"

	InstanceRoleOwner InstanceRole = "instance_owner"
	InstanceRoleAdmin InstanceRole = "instance_admin"

	ProjectStatusActive   ProjectStatus = "active"
	ProjectStatusDisabled ProjectStatus = "disabled"
	ProjectStatusDeleting ProjectStatus = "deleting"

	// OverLimitReject refuses a request that is over the project's ingest
	// limit. The cap is exact, and whichever callers arrive first in a second
	// are the ones that get through.
	OverLimitReject OverLimitBehavior = "reject"
	// OverLimitSample sheds over-limit traffic by caller instead, so a session
	// is either reported whole or not at all. The cap becomes approximate in
	// exchange, bounded by a hard ceiling in internal/ingest.
	OverLimitSample OverLimitBehavior = "sample"
)

// OverLimitBehavior says what ingest does with a project's traffic once the
// project is over its own rate limit.
//
// The choice exists because the two answers fail differently and neither is
// right for everyone. Refusing tears a burst in half, so a session that started
// before the burst ends mid-recording and its metrics are computed from an
// incomplete page. Shedding by caller keeps every session it admits complete,
// which is what makes rates and Web Vitals comparable, but it stops being an
// exact cap.
type OverLimitBehavior string

type User struct {
	ID           uuid.UUID
	Email        string
	DisplayName  string
	PasswordHash *string
	Status       UserStatus
	AuthSource   AuthSource
	OIDCSubject  *string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type Organization struct {
	ID        uuid.UUID
	Name      string
	Slug      string
	CreatedBy uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
}

type OrganizationMember struct {
	OrganizationID uuid.UUID
	UserID         uuid.UUID
	Role           OrganizationRole
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type InstanceMember struct {
	UserID    uuid.UUID
	Role      InstanceRole
	CreatedBy *uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Project struct {
	ID              uuid.UUID
	OrganizationID  uuid.UUID
	Name            string
	Slug            string
	AllowedOrigins  []string
	Environment     string
	RetentionDays   int16
	EventSampleRate float64
	APISampleRate   float64
	ErrorSampleRate float64
	// IngestRateLimit is the project's own ceiling in requests per second. Nil
	// means the instance default applies, which is how every project behaved
	// while the limit was a constant shared by all of them.
	IngestRateLimit   *int32
	OverLimitBehavior OverLimitBehavior
	Status            ProjectStatus
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type ProjectKey struct {
	ID         uuid.UUID
	ProjectID  uuid.UUID
	KeyPrefix  string
	KeyHash    []byte
	Name       string
	LastUsedAt *time.Time
	RevokedAt  *time.Time
	CreatedAt  time.Time
}

type Session struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	TokenHash     []byte
	IPHash        []byte
	UserAgent     string
	ExpiresAt     time.Time
	IdleExpiresAt time.Time
	RevokedAt     *time.Time
	CreatedAt     time.Time
	LastSeenAt    time.Time
}

type AuditLog struct {
	ID             int64
	OrganizationID uuid.UUID
	ActorUserID    *uuid.UUID
	Action         string
	ResourceType   string
	ResourceID     *uuid.UUID
	Metadata       json.RawMessage
	CreatedAt      time.Time
}
