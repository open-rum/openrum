package auth

import (
	"errors"

	"openrum/internal/metadata"
)

type Action string

const (
	ActionReadProject   Action = "project.read"
	ActionResolveIssue  Action = "issue.resolve"
	ActionManageKeys    Action = "project.keys.manage"
	ActionManageAlerts  Action = "alerts.manage"
	ActionManageMembers Action = "members.manage"
	ActionConfigureOIDC Action = "oidc.configure"
	ActionDeleteOrg     Action = "organization.delete"
)

var ErrForbidden = errors.New("action is forbidden")

func Can(role metadata.OrganizationRole, action Action) bool {
	switch action {
	case ActionReadProject:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin || role == metadata.RoleMember || role == metadata.RoleViewer
	case ActionResolveIssue:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin || role == metadata.RoleMember
	case ActionManageKeys:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin
	case ActionManageAlerts:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin || role == metadata.RoleMember
	case ActionManageMembers:
		return role == metadata.RoleOwner || role == metadata.RoleAdmin
	case ActionConfigureOIDC, ActionDeleteOrg:
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
