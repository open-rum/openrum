package auth

import (
	"errors"

	"openrum/internal/metadata"
)

type Action string
type InstanceAction string

const (
	ActionReadProject    Action = "project.read"
	ActionSendTestEvent  Action = "project.test-event.send"
	ActionResolveIssue   Action = "issue.resolve"
	ActionManageReleases Action = "releases.manage"
	ActionManageKeys     Action = "project.keys.manage"
	ActionDeleteProject  Action = "project.delete"
	ActionManageAlerts   Action = "alerts.manage"
	// ActionManageChannels covers organization notification channels, which hold
	// delivery secrets. Members manage rules but not where alerts are sent.
	ActionManageChannels Action = "channels.manage"
	ActionManageMembers  Action = "members.manage"
	ActionConfigureOIDC  Action = "oidc.configure"
	ActionDeleteOrg      Action = "organization.delete"
)

const (
	InstanceActionRead             InstanceAction = "instance.read"
	InstanceActionManageMembers    InstanceAction = "instance.members.manage"
	InstanceActionManageSettings   InstanceAction = "instance.settings.manage"
	InstanceActionDangerousChanges InstanceAction = "instance.dangerous.manage"
)

var ErrForbidden = errors.New("action is forbidden")

func Can(role metadata.OrganizationRole, action Action) bool {
	switch action {
	case ActionReadProject:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin || role == metadata.RoleMember || role == metadata.RoleViewer
	case ActionResolveIssue, ActionSendTestEvent, ActionManageReleases:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin || role == metadata.RoleMember
	case ActionManageKeys, ActionManageChannels:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin
	case ActionManageAlerts:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin || role == metadata.RoleMember
	case ActionManageMembers:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin
	case ActionDeleteProject, ActionConfigureOIDC, ActionDeleteOrg:
		return role == metadata.RoleOwner
	default:
		return false
	}
}

func Authorize(role metadata.OrganizationRole, action Action) error {
	if !Can(role, action) {
		return ErrForbidden
	}
	return nil
}

func CanInstance(role metadata.InstanceRole, action InstanceAction) bool {
	switch action {
	case InstanceActionRead, InstanceActionManageSettings:
		return role == metadata.InstanceRoleOwner || role == metadata.InstanceRoleAdmin
	case InstanceActionManageMembers, InstanceActionDangerousChanges:
		return role == metadata.InstanceRoleOwner
	default:
		return false
	}
}

func AuthorizeInstance(role metadata.InstanceRole, action InstanceAction) error {
	if !CanInstance(role, action) {
		return ErrForbidden
	}
	return nil
}
