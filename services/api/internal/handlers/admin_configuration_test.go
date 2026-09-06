package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type fakeInstanceSettings struct {
	settings    map[config.SettingID]metadata.InstanceSetting
	mutationErr error
}

func (fake *fakeInstanceSettings) List(context.Context) ([]metadata.InstanceSetting, error) {
	result := make([]metadata.InstanceSetting, 0, len(fake.settings))
	for _, setting := range fake.settings {
		result = append(result, setting)
	}
	return result, nil
}

func (fake *fakeInstanceSettings) Set(
	_ context.Context,
	actorID uuid.UUID,
	namespace string,
	key string,
	value json.RawMessage,
	expectedVersion int64,
) (metadata.InstanceSetting, error) {
	if fake.mutationErr != nil {
		return metadata.InstanceSetting{}, fake.mutationErr
	}
	id := config.SettingID{Namespace: namespace, Key: key}
	current, exists := fake.settings[id]
	if (!exists && expectedVersion != 0) || (exists && current.Version != expectedVersion) {
		return metadata.InstanceSetting{}, metadata.ErrConfigVersionConflict
	}
	version := int64(1)
	if exists {
		version = current.Version + 1
	}
	now := time.Now().UTC()
	setting := metadata.InstanceSetting{
		Namespace: namespace, Key: key, Value: append(json.RawMessage(nil), value...), Version: version,
		Source: "instance", UpdatedBy: &actorID, CreatedAt: now, UpdatedAt: now,
	}
	fake.settings[id] = setting
	return setting, nil
}

func TestAdminConfigurationReportsEffectiveSourceAndLock(t *testing.T) {
	ownerID, organizationOwnerID := uuid.New(), uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{ownerID: metadata.InstanceRoleOwner}}
	settings := &fakeInstanceSettings{settings: map[config.SettingID]metadata.InstanceSetting{}}
	definitions := testSystemSettingDefinitions()
	definitions[0].DeploymentValue = json.RawMessage("21")
	router := adminConfigurationTestRouter(settings, members, definitions, map[string]auth.Principal{
		"owner": {UserID: ownerID}, "organization-owner": {UserID: organizationOwnerID},
	})

	response := performAdminRequest(router, "owner", http.MethodGet, "/api/v1/admin/configuration", "", false)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"effectiveValue":21`) ||
		!strings.Contains(response.Body.String(), `"source":"deployment"`) || !strings.Contains(response.Body.String(), `"locked":true`) {
		t.Fatalf("GET status=%d body=%s", response.Code, response.Body.String())
	}
	response = performAdminRequest(router, "organization-owner", http.MethodGet, "/api/v1/admin/configuration", "", false)
	if response.Code != http.StatusForbidden {
		t.Fatalf("organization owner status=%d body=%s", response.Code, response.Body.String())
	}

	response = performAdminRequest(router, "owner", http.MethodPatch, "/api/v1/admin/configuration",
		`{"namespace":"retention","key":"rawDays","value":30,"expectedVersion":0}`, true)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "CONFIG_DEPLOYMENT_LOCKED") {
		t.Fatalf("locked PATCH status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminConfigurationUsesOptimisticVersion(t *testing.T) {
	ownerID := uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{ownerID: metadata.InstanceRoleOwner}}
	settings := &fakeInstanceSettings{settings: map[config.SettingID]metadata.InstanceSetting{}}
	router := adminConfigurationTestRouter(settings, members, testSystemSettingDefinitions(),
		map[string]auth.Principal{"owner": {UserID: ownerID}})
	body := `{"namespace":"retention","key":"aggregateDays","value":120,"expectedVersion":0}`

	response := performAdminRequest(router, "owner", http.MethodPatch, "/api/v1/admin/configuration", body, true)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"version":1`) ||
		!strings.Contains(response.Body.String(), `"source":"instance"`) {
		t.Fatalf("first PATCH status=%d body=%s", response.Code, response.Body.String())
	}
	response = performAdminRequest(router, "owner", http.MethodPatch, "/api/v1/admin/configuration", body, true)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "CONFIG_VERSION_CONFLICT") {
		t.Fatalf("stale PATCH status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminConfigurationRejectsExpiredElevation(t *testing.T) {
	ownerID := uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{ownerID: metadata.InstanceRoleOwner}}
	settings := &fakeInstanceSettings{settings: map[config.SettingID]metadata.InstanceSetting{}}
	router := adminConfigurationTestRouterWithElevation(
		settings,
		members,
		testSystemSettingDefinitions(),
		map[string]auth.Principal{"owner": {UserID: ownerID}},
		retentionReauthFixture{err: auth.ErrReauthenticationRequired},
	)
	response := performAdminRequest(router, "owner", http.MethodPatch, "/api/v1/admin/configuration",
		`{"namespace":"retention","key":"aggregateDays","value":120,"expectedVersion":0}`, true)
	if response.Code != http.StatusUnauthorized || len(settings.settings) != 0 || !strings.Contains(response.Body.String(), "REAUTHENTICATION_REQUIRED") {
		t.Fatalf("status=%d settings=%d body=%s", response.Code, len(settings.settings), response.Body.String())
	}
}

func testSystemSettingDefinitions() []config.SystemSettingDefinition {
	validateInteger := func(raw json.RawMessage) bool {
		var value int
		return json.Unmarshal(raw, &value) == nil && value >= 0 && value <= 730
	}
	return []config.SystemSettingDefinition{
		{ID: config.SettingID{Namespace: "retention", Key: "rawDays"}, DefaultValue: json.RawMessage("14"), Validate: validateInteger},
		{ID: config.SettingID{Namespace: "retention", Key: "aggregateDays"}, DefaultValue: json.RawMessage("90"), Validate: validateInteger},
	}
}

func adminConfigurationTestRouter(
	settings instanceSettings,
	members instanceSettingRoles,
	definitions []config.SystemSettingDefinition,
	principals map[string]auth.Principal,
) http.Handler {
	return adminConfigurationTestRouterWithElevation(settings, members, definitions, principals, retentionReauthFixture{})
}

func adminConfigurationTestRouterWithElevation(
	settings instanceSettings,
	members instanceSettingRoles,
	definitions []config.SystemSettingDefinition,
	principals map[string]auth.Principal,
	reauth recentElevationChecker,
) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	handler := NewAdminConfigurationHandler(settings, members, reauth, definitions, zerolog.Nop())
	requireSession := httpx.RequireSession(adminAuthenticator{principals: principals})
	baseURL, _ := url.Parse("http://openrum.test")
	requireCSRF := httpx.RequireCSRF(baseURL)
	router.Handle("GET /api/v1/admin/configuration", requireSession(http.HandlerFunc(handler.Get)))
	router.Handle("PATCH /api/v1/admin/configuration", requireSession(requireCSRF(http.HandlerFunc(handler.Patch))))
	return router
}
