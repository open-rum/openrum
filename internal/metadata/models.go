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
)

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
	Status          ProjectStatus
	CreatedAt       time.Time
	UpdatedAt       time.Time
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
