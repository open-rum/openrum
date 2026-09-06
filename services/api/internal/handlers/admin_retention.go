package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

var ErrRetentionPolicyMismatch = errors.New("requested retention does not match the effective project policy")

type retentionMaintenance interface {
	CreateRetentionPreview(context.Context, uuid.UUID, metadata.RetentionPlan) (metadata.RetentionPreview, error)
	CreateRetentionJob(context.Context, uuid.UUID, string) (metadata.MaintenanceJob, error)
	List(context.Context, int) ([]metadata.MaintenanceJob, error)
}

type retentionPolicyReader interface {
	GetRetentionPolicy(context.Context, uuid.UUID, []config.SystemSettingDefinition) (metadata.ProjectRetentionPolicy, error)
}

type retentionReauthenticator interface {
	Elevate(context.Context, auth.Principal, string) error
	RequireRecentElevation(context.Context, auth.Principal, time.Duration) error
}

type RetentionPreviewSource interface {
	Plan(context.Context, uuid.UUID, int, int) (metadata.RetentionPlan, error)
}

type AdminRetentionHandler struct {
	members     instanceSettingRoles
	maintenance retentionMaintenance
	policies    retentionPolicyReader
	preview     RetentionPreviewSource
	reauth      retentionReauthenticator
	definitions []config.SystemSettingDefinition
	logger      zerolog.Logger
}

type retentionPreviewRequest struct {
	ProjectID     string `json:"projectId"`
	RawDays       int    `json:"rawDays"`
	AggregateDays int    `json:"aggregateDays"`
}

type retentionJobRequest struct {
	PreviewToken    string `json:"previewToken"`
	CurrentPassword string `json:"currentPassword"`
}

type retentionPreviewResponse struct {
	PreviewToken  string                       `json:"previewToken"`
	ExpiresAt     string                       `json:"expiresAt"`
	ProjectID     string                       `json:"projectId"`
	RawDays       int                          `json:"rawDays"`
	AggregateDays int                          `json:"aggregateDays"`
	AffectedRows  uint64                       `json:"affectedRows"`
	DeleteRows    uint64                       `json:"deleteRows"`
	Steps         []metadata.RetentionPlanStep `json:"steps"`
	CannotRestore bool                         `json:"cannotRestoreDeletedData"`
}

type maintenanceJobResponse struct {
	ID             string  `json:"id"`
	Type           string  `json:"type"`
	Status         string  `json:"status"`
	ProjectID      string  `json:"projectId"`
	RawDays        int     `json:"rawDays"`
	AggregateDays  int     `json:"aggregateDays"`
	AffectedRows   uint64  `json:"affectedRows"`
	DeleteRows     uint64  `json:"deleteRows"`
	TotalSteps     int     `json:"totalSteps"`
	CompletedSteps int     `json:"completedSteps"`
	Attempts       int     `json:"attempts"`
	LastError      string  `json:"lastError,omitempty"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
	StartedAt      *string `json:"startedAt"`
	CompletedAt    *string `json:"completedAt"`
}

func NewAdminRetentionHandler(
	members instanceSettingRoles,
	maintenance retentionMaintenance,
	policies retentionPolicyReader,
	preview RetentionPreviewSource,
	reauth retentionReauthenticator,
	definitions []config.SystemSettingDefinition,
	logger zerolog.Logger,
) *AdminRetentionHandler {
	return &AdminRetentionHandler{
		members: members, maintenance: maintenance, policies: policies, preview: preview, reauth: reauth,
		definitions: definitions, logger: logger,
	}
}

func (handler *AdminRetentionHandler) Preview(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionManageSettings)
	if !ok {
		return
	}
	var payload retentionPreviewRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	projectID, err := uuid.Parse(payload.ProjectID)
	if err != nil || payload.RawDays < 1 || payload.RawDays > 90 || payload.AggregateDays < 1 || payload.AggregateDays > 730 {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Project and retention values are invalid.")
		return
	}
	effective, err := handler.policies.GetRetentionPolicy(request.Context(), projectID, handler.definitions)
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	if effective.RawDays != payload.RawDays || effective.AggregateDays != payload.AggregateDays {
		handler.writeError(writer, request, ErrRetentionPolicyMismatch)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 5*time.Second)
	defer cancel()
	plan, err := handler.preview.Plan(ctx, projectID, payload.RawDays, payload.AggregateDays)
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	preview, err := handler.maintenance.CreateRetentionPreview(request.Context(), principal.UserID, plan)
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, retentionPreviewResponse{
		PreviewToken: preview.Token, ExpiresAt: preview.ExpiresAt.Format(timeFormat), ProjectID: projectID.String(),
		RawDays: plan.RawDays, AggregateDays: plan.AggregateDays, AffectedRows: plan.AffectedRows,
		DeleteRows: plan.DeleteRows, Steps: plan.Steps, CannotRestore: plan.DeleteRows > 0,
	})
}

func (handler *AdminRetentionHandler) CreateJob(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionDangerousChanges)
	if !ok {
		return
	}
	var payload retentionJobRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if payload.PreviewToken == "" || payload.CurrentPassword == "" {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Preview token and current password are required.")
		return
	}
	if err := handler.reauth.Elevate(request.Context(), principal, payload.CurrentPassword); err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			httpx.WriteError(writer, request, http.StatusUnauthorized, "REAUTHENTICATION_FAILED", "Current password is incorrect or unavailable for this account.")
			return
		}
		handler.writeError(writer, request, err)
		return
	}
	if err := handler.reauth.RequireRecentElevation(request.Context(), principal, 5*time.Minute); err != nil {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "REAUTHENTICATION_REQUIRED", "Re-authenticate before this dangerous operation.")
		return
	}
	job, err := handler.maintenance.CreateRetentionJob(request.Context(), principal.UserID, payload.PreviewToken)
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusAccepted, maintenanceJobToResponse(job))
}

func (handler *AdminRetentionHandler) ListJobs(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorize(writer, request, auth.InstanceActionRead); !ok {
		return
	}
	jobs, err := handler.maintenance.List(request.Context(), 50)
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	response := make([]maintenanceJobResponse, 0, len(jobs))
	for _, job := range jobs {
		response = append(response, maintenanceJobToResponse(job))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"jobs": response})
}

func (handler *AdminRetentionHandler) authorize(writer http.ResponseWriter, request *http.Request, action auth.InstanceAction) (auth.Principal, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return auth.Principal{}, false
	}
	role, err := handler.members.RoleForUser(request.Context(), principal.UserID)
	if err != nil || auth.AuthorizeInstance(role, action) != nil {
		if err == nil {
			err = metadata.ErrForbidden
		}
		writeControlPlaneError(writer, request, handler.logger, err)
		return auth.Principal{}, false
	}
	return principal, true
}

func (handler *AdminRetentionHandler) writeError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, metadata.ErrNoRetentionChanges):
		httpx.WriteError(writer, request, http.StatusConflict, "NO_RETENTION_CHANGES", "Existing data already follows this retention policy.")
	case errors.Is(err, metadata.ErrInvalidPreviewToken):
		httpx.WriteError(writer, request, http.StatusConflict, "RETENTION_PREVIEW_EXPIRED", "The preview expired or was already used. Create a new preview.")
	case errors.Is(err, ErrRetentionPolicyMismatch):
		httpx.WriteError(writer, request, http.StatusConflict, "RETENTION_POLICY_CHANGED", "The requested values do not match the effective project policy.")
	default:
		writeControlPlaneError(writer, request, handler.logger, err)
	}
}

func maintenanceJobToResponse(job metadata.MaintenanceJob) maintenanceJobResponse {
	response := maintenanceJobResponse{
		ID: job.ID.String(), Type: job.Type, Status: job.Status, ProjectID: job.ProjectID.String(),
		RawDays: job.RawDays, AggregateDays: job.AggregateDays, AffectedRows: job.AffectedRows,
		DeleteRows: job.DeleteRows, TotalSteps: job.TotalSteps, CompletedSteps: job.CompletedSteps,
		Attempts: job.Attempts, LastError: job.LastError, CreatedAt: job.CreatedAt.Format(timeFormat),
		UpdatedAt: job.UpdatedAt.Format(timeFormat),
	}
	if job.StartedAt != nil {
		value := job.StartedAt.Format(timeFormat)
		response.StartedAt = &value
	}
	if job.CompletedAt != nil {
		value := job.CompletedAt.Format(timeFormat)
		response.CompletedAt = &value
	}
	return response
}

type SQLRetentionPreviewSource struct{ database *sql.DB }

func NewSQLRetentionPreviewSource(database *sql.DB) *SQLRetentionPreviewSource {
	return &SQLRetentionPreviewSource{database: database}
}

type retentionTableDefinition struct {
	table, timeColumn, expiryColumn string
	bucketSeconds                   int
	raw                             bool
}

var retentionProductTables = []retentionTableDefinition{
	{table: "rum_events_local", timeColumn: "timestamp", expiryColumn: "raw_expires_at", raw: true},
	{table: "project_metrics_1m_local", timeColumn: "bucket", expiryColumn: "aggregate_expires_at", bucketSeconds: 60},
	{table: "api_metrics_1m_local", timeColumn: "bucket", expiryColumn: "aggregate_expires_at", bucketSeconds: 60},
	{table: "issue_metrics_5m_local", timeColumn: "bucket", expiryColumn: "aggregate_expires_at", bucketSeconds: 300},
	{table: "behavior_metrics_1m_local", timeColumn: "bucket", expiryColumn: "aggregate_expires_at", bucketSeconds: 60},
}

func (source *SQLRetentionPreviewSource) Plan(ctx context.Context, projectID uuid.UUID, rawDays, aggregateDays int) (metadata.RetentionPlan, error) {
	plan := metadata.RetentionPlan{ProjectID: projectID, RawDays: rawDays, AggregateDays: aggregateDays}
	for _, definition := range retentionProductTables {
		days := aggregateDays
		if definition.raw {
			days = rawDays
		}
		query := fmt.Sprintf(`SELECT toYYYYMM(%s) AS month_key,
			countIf(%s < toDateTime64(%s,3,'UTC') + toIntervalDay(?) OR
				%s > toDateTime64(%s,3,'UTC') + toIntervalDay(?) + toIntervalSecond(%d)) AS affected,
			countIf(toDateTime64(%s,3,'UTC') + toIntervalDay(?) + toIntervalSecond(%d) <= now64(3)) AS deleted
			FROM %s WHERE project_id=? GROUP BY month_key HAVING affected>0 ORDER BY month_key`,
			definition.timeColumn, definition.expiryColumn, definition.timeColumn,
			definition.expiryColumn, definition.timeColumn, definition.bucketSeconds,
			definition.timeColumn, definition.bucketSeconds, definition.table)
		rows, err := source.database.QueryContext(ctx, query, days, days, days, projectID)
		if err != nil {
			return metadata.RetentionPlan{}, fmt.Errorf("preview retention for %s: %w", definition.table, err)
		}
		for rows.Next() {
			var step metadata.RetentionPlanStep
			step.Table, step.TimeColumn, step.RetentionDays = definition.table, definition.timeColumn, days
			if err := rows.Scan(&step.Month, &step.AffectedRows, &step.DeleteRows); err != nil {
				_ = rows.Close()
				return metadata.RetentionPlan{}, err
			}
			plan.AffectedRows += step.AffectedRows
			plan.DeleteRows += step.DeleteRows
			plan.Steps = append(plan.Steps, step)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return metadata.RetentionPlan{}, err
		}
		if err := rows.Close(); err != nil {
			return metadata.RetentionPlan{}, err
		}
	}
	return plan, nil
}
