package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type instanceSettings interface {
	List(context.Context) ([]metadata.InstanceSetting, error)
	Set(context.Context, uuid.UUID, string, string, json.RawMessage, int64) (metadata.InstanceSetting, error)
}

type instanceSettingRoles interface {
	RoleForUser(context.Context, uuid.UUID) (metadata.InstanceRole, error)
}

type AdminConfigurationHandler struct {
	settings    instanceSettings
	members     instanceSettingRoles
	reauth      recentElevationChecker
	definitions []config.SystemSettingDefinition
	logger      zerolog.Logger
}

type adminConfigurationPatchRequest struct {
	Namespace       string          `json:"namespace"`
	Key             string          `json:"key"`
	Value           json.RawMessage `json:"value"`
	ExpectedVersion int64           `json:"expectedVersion"`
}

type adminConfigurationSettingResponse struct {
	Namespace      string               `json:"namespace"`
	Key            string               `json:"key"`
	EffectiveValue json.RawMessage      `json:"effectiveValue"`
	Source         config.SettingSource `json:"source"`
	Locked         bool                 `json:"locked"`
	Version        int64                `json:"version"`
	UpdatedAt      *string              `json:"updatedAt"`
}

func NewAdminConfigurationHandler(
	settings instanceSettings,
	members instanceSettingRoles,
	reauth recentElevationChecker,
	definitions []config.SystemSettingDefinition,
	logger zerolog.Logger,
) *AdminConfigurationHandler {
	return &AdminConfigurationHandler{settings: settings, members: members, reauth: reauth, definitions: definitions, logger: logger}
}

func (handler *AdminConfigurationHandler) Get(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorize(writer, request, auth.InstanceActionRead); !ok {
		return
	}
	settings, err := handler.resolve(request.Context())
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"settings": settings})
}

func (handler *AdminConfigurationHandler) Patch(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionManageSettings)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.reauth, handler.logger) {
		return
	}
	var payload adminConfigurationPatchRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	definition, found := handler.definition(config.SettingID{Namespace: payload.Namespace, Key: payload.Key})
	if !found || payload.ExpectedVersion < 0 || !definition.Validate(payload.Value) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Configuration key, value, or version is invalid.")
		return
	}
	if len(definition.DeploymentValue) > 0 {
		httpx.WriteError(writer, request, http.StatusConflict, "CONFIG_DEPLOYMENT_LOCKED", "This setting is managed by the deployment configuration.")
		return
	}
	if _, err := handler.settings.Set(request.Context(), principal.UserID, payload.Namespace, payload.Key, payload.Value, payload.ExpectedVersion); err != nil {
		handler.writeError(writer, request, err)
		return
	}
	settings, err := handler.resolve(request.Context())
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	for _, setting := range settings {
		if setting.Namespace == payload.Namespace && setting.Key == payload.Key {
			writeJSON(writer, http.StatusOK, setting)
			return
		}
	}
	handler.writeError(writer, request, errors.New("updated configuration disappeared"))
}

func (handler *AdminConfigurationHandler) resolve(ctx context.Context) ([]adminConfigurationSettingResponse, error) {
	persisted, err := handler.settings.List(ctx)
	if err != nil {
		return nil, err
	}
	stored := make([]config.StoredSystemSetting, 0, len(persisted))
	for _, setting := range persisted {
		stored = append(stored, config.StoredSystemSetting{
			ID:    config.SettingID{Namespace: setting.Namespace, Key: setting.Key},
			Value: setting.Value, Version: setting.Version, UpdatedAt: setting.UpdatedAt,
		})
	}
	effective := config.ResolveSystemSettings(handler.definitions, stored, nil)
	response := make([]adminConfigurationSettingResponse, 0, len(effective))
	for _, setting := range effective {
		var updatedAt *string
		if setting.UpdatedAt != nil {
			formatted := setting.UpdatedAt.UTC().Format(timeFormat)
			updatedAt = &formatted
		}
		response = append(response, adminConfigurationSettingResponse{
			Namespace: setting.ID.Namespace, Key: setting.ID.Key, EffectiveValue: setting.Value,
			Source: setting.Source, Locked: setting.Locked, Version: setting.Version, UpdatedAt: updatedAt,
		})
	}
	return response, nil
}

func (handler *AdminConfigurationHandler) definition(id config.SettingID) (config.SystemSettingDefinition, bool) {
	for _, definition := range handler.definitions {
		if definition.ID == id {
			return definition, true
		}
	}
	return config.SystemSettingDefinition{}, false
}

func (handler *AdminConfigurationHandler) authorize(
	writer http.ResponseWriter,
	request *http.Request,
	action auth.InstanceAction,
) (auth.Principal, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return auth.Principal{}, false
	}
	role, err := handler.members.RoleForUser(request.Context(), principal.UserID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return auth.Principal{}, false
	}
	if err := auth.AuthorizeInstance(role, action); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return auth.Principal{}, false
	}
	return principal, true
}

func (handler *AdminConfigurationHandler) writeError(writer http.ResponseWriter, request *http.Request, err error) {
	if errors.Is(err, metadata.ErrConfigVersionConflict) {
		httpx.WriteError(writer, request, http.StatusConflict, "CONFIG_VERSION_CONFLICT", "The configuration changed. Reload and try again.")
		return
	}
	writeControlPlaneError(writer, request, handler.logger, err)
}
