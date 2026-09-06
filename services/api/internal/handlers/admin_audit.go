package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type instanceAuditStore interface {
	Record(context.Context, metadata.InstanceAuditEntry) error
	List(context.Context, int) ([]metadata.InstanceAuditEntry, error)
}

type AdminAuditHandler struct {
	members instanceSettingRoles
	audit   instanceAuditStore
	logger  zerolog.Logger
}

func NewAdminAuditHandler(members instanceSettingRoles, audit instanceAuditStore, logger zerolog.Logger) *AdminAuditHandler {
	return &AdminAuditHandler{members: members, audit: audit, logger: logger}
}

func (handler *AdminAuditHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	role, err := handler.members.RoleForUser(request.Context(), principal.UserID)
	if err != nil || auth.AuthorizeInstance(role, auth.InstanceActionRead) != nil {
		writeControlPlaneError(writer, request, handler.logger, metadata.ErrForbidden)
		return
	}
	entries, err := handler.audit.List(request.Context(), 100)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	response := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		response = append(response, map[string]any{
			"id": entry.ID, "actorEmail": entry.ActorEmail, "requestId": entry.RequestID,
			"action": entry.Action, "resourceType": entry.ResourceType, "resourcePath": entry.ResourcePath,
			"configSource": entry.ConfigSource, "changeSummary": entry.ChangeSummary,
			"createdAt": entry.CreatedAt.UTC().Format(timeFormat),
		})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"entries": response})
}

type auditStatusRecorder struct {
	http.ResponseWriter
	status int
}

func (recorder *auditStatusRecorder) WriteHeader(status int) {
	recorder.status = status
	recorder.ResponseWriter.WriteHeader(status)
}

func AdminMutationAudit(audit instanceAuditStore, logger zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			recorder := &auditStatusRecorder{ResponseWriter: writer, status: http.StatusOK}
			next.ServeHTTP(recorder, request)
			if recorder.status < 200 || recorder.status >= 300 {
				return
			}
			principal, ok := httpx.PrincipalFromContext(request.Context())
			if !ok {
				return
			}
			summary, _ := json.Marshal(map[string]string{"method": request.Method})
			actor := principal.UserID
			entry := metadata.InstanceAuditEntry{ActorUserID: &actor, RequestID: httpx.RequestIDFromContext(request.Context()),
				Action: request.Method + " " + request.URL.Path, ResourceType: auditResourceType(request.URL.Path),
				ResourcePath: request.URL.Path, ConfigSource: "request", ChangeSummary: summary}
			if err := audit.Record(request.Context(), entry); err != nil {
				logger.Error().Err(err).Str("request_id", entry.RequestID).Msg("record instance audit entry")
			}
		})
	}
}

func auditResourceType(path string) string {
	for _, value := range []string{"retention", "object-storage", "members", "configuration"} {
		if strings.Contains(path, value) {
			return value
		}
	}
	return "instance"
}
