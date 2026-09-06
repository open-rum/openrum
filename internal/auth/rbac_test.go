package auth

import (
	"testing"

	"openrum/internal/metadata"
)

func TestRoleMatrix(t *testing.T) {
	tests := []struct {
		action  Action
		allowed map[metadata.OrganizationRole]bool
	}{
		{ActionReadProject, map[metadata.OrganizationRole]bool{metadata.RoleOwner: true, metadata.RoleAdmin: true, metadata.RoleMember: true, metadata.RoleViewer: true}},
		{ActionSendTestEvent, map[metadata.OrganizationRole]bool{metadata.RoleOwner: true, metadata.RoleAdmin: true, metadata.RoleMember: true}},
		{ActionResolveIssue, map[metadata.OrganizationRole]bool{metadata.RoleOwner: true, metadata.RoleAdmin: true, metadata.RoleMember: true}},
		{ActionManageReleases, map[metadata.OrganizationRole]bool{metadata.RoleOwner: true, metadata.RoleAdmin: true, metadata.RoleMember: true}},
		{ActionManageKeys, map[metadata.OrganizationRole]bool{metadata.RoleOwner: true, metadata.RoleAdmin: true}},
		{ActionManageAlerts, map[metadata.OrganizationRole]bool{metadata.RoleOwner: true, metadata.RoleAdmin: true, metadata.RoleMember: true}},
		{ActionManageMembers, map[metadata.OrganizationRole]bool{metadata.RoleOwner: true, metadata.RoleAdmin: true}},
		{ActionConfigureOIDC, map[metadata.OrganizationRole]bool{metadata.RoleOwner: true}},
		{ActionDeleteOrg, map[metadata.OrganizationRole]bool{metadata.RoleOwner: true}},
	}
	roles := []metadata.OrganizationRole{metadata.RoleOwner, metadata.RoleAdmin, metadata.RoleMember, metadata.RoleViewer}
	for _, test := range tests {
		for _, role := range roles {
			if got, want := Can(role, test.action), test.allowed[role]; got != want {
				t.Errorf("Can(%s, %s)=%v want %v", role, test.action, got, want)
			}
		}
	}
	if Can(metadata.RoleOwner, Action("unknown")) {
		t.Fatal("unknown action was allowed")
	}
}

func TestInstanceRoleMatrix(t *testing.T) {
	tests := []struct {
		action  InstanceAction
		allowed map[metadata.InstanceRole]bool
	}{
		{InstanceActionRead, map[metadata.InstanceRole]bool{metadata.InstanceRoleOwner: true, metadata.InstanceRoleAdmin: true}},
		{InstanceActionManageSettings, map[metadata.InstanceRole]bool{metadata.InstanceRoleOwner: true, metadata.InstanceRoleAdmin: true}},
		{InstanceActionManageMembers, map[metadata.InstanceRole]bool{metadata.InstanceRoleOwner: true}},
		{InstanceActionDangerousChanges, map[metadata.InstanceRole]bool{metadata.InstanceRoleOwner: true}},
	}
	roles := []metadata.InstanceRole{metadata.InstanceRoleOwner, metadata.InstanceRoleAdmin, ""}
	for _, test := range tests {
		for _, role := range roles {
			if got, want := CanInstance(role, test.action), test.allowed[role]; got != want {
				t.Errorf("CanInstance(%s, %s)=%v want %v", role, test.action, got, want)
			}
		}
	}
	if CanInstance(metadata.InstanceRoleOwner, InstanceAction("unknown")) {
		t.Fatal("unknown instance action was allowed")
	}
}
