package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/storagepressure"
)

const emergencyCleanupTargetUsedPercent = 85
const emergencyCleanupRecentDataFloor = 24 * time.Hour
const emergencyCleanupConfirmation = "清理旧数据"

var (
	ErrEmergencyCleanupUnavailable  = errors.New("storage pressure is not active")
	ErrEmergencyCleanupProbeFailed  = errors.New("storage capacity is unavailable")
	ErrNoEmergencyCleanupCandidates = errors.New("no old partitions are safe to delete")
)

type emergencyCleanupMaintenance interface {
	CreatePreview(context.Context, uuid.UUID, metadata.EmergencyCleanupPlan) (metadata.EmergencyCleanupPreview, error)
	CreateJob(context.Context, uuid.UUID, string) (metadata.EmergencyCleanupJob, error)
	Latest(context.Context) (metadata.EmergencyCleanupJob, bool, error)
}

type EmergencyCleanupPlanner interface {
	Plan(context.Context, storagepressure.Snapshot) (metadata.EmergencyCleanupPlan, error)
}

type AdminEmergencyCleanupHandler struct {
	members     instanceSettingRoles
	maintenance emergencyCleanupMaintenance
	planner     EmergencyCleanupPlanner
	pressure    storagePressureSnapshotter
	reauth      retentionReauthenticator
	logger      zerolog.Logger
}

type emergencyCleanupJobRequest struct {
	PreviewToken    string `json:"previewToken"`
	CurrentPassword string `json:"currentPassword"`
	Confirmation    string `json:"confirmation"`
}

type emergencyCleanupGroupResponse struct {
	ProjectID      string `json:"projectId"`
	ProjectName    string `json:"projectName"`
	Month          int    `json:"month"`
	AffectedRows   uint64 `json:"affectedRows"`
	EstimatedBytes uint64 `json:"estimatedBytes"`
	OldestAt       string `json:"oldestAt"`
	NewestAt       string `json:"newestAt"`
}

type emergencyCleanupPreviewResponse struct {
	PreviewToken          string                          `json:"previewToken"`
	ExpiresAt             string                          `json:"expiresAt"`
	UsedBytes             uint64                          `json:"usedBytes"`
	CapacityBytes         uint64                          `json:"capacityBytes"`
	EstimatedReleaseBytes uint64                          `json:"estimatedReleaseBytes"`
	ProjectedUsedBytes    uint64                          `json:"projectedUsedBytes"`
	TargetUsedPercent     int                             `json:"targetUsedPercent"`
	ProtectedAfter        string                          `json:"protectedAfter"`
	CanReachTarget        bool                            `json:"canReachTarget"`
	Groups                []emergencyCleanupGroupResponse `json:"groups"`
}

type emergencyCleanupJobResponse struct {
	ID                    string  `json:"id"`
	Status                string  `json:"status"`
	UsedBytesBefore       uint64  `json:"usedBytesBefore"`
	CapacityBytes         uint64  `json:"capacityBytes"`
	EstimatedReleaseBytes uint64  `json:"estimatedReleaseBytes"`
	TargetUsedPercent     int     `json:"targetUsedPercent"`
	ProtectedAfter        string  `json:"protectedAfter"`
	CanReachTarget        bool    `json:"canReachTarget"`
	TotalSteps            int     `json:"totalSteps"`
	CompletedSteps        int     `json:"completedSteps"`
	Attempts              int     `json:"attempts"`
	LastError             string  `json:"lastError,omitempty"`
	CreatedAt             string  `json:"createdAt"`
	UpdatedAt             string  `json:"updatedAt"`
	StartedAt             *string `json:"startedAt"`
	CompletedAt           *string `json:"completedAt"`
}

func NewAdminEmergencyCleanupHandler(
	members instanceSettingRoles,
	maintenance emergencyCleanupMaintenance,
	planner EmergencyCleanupPlanner,
	pressure storagePressureSnapshotter,
	reauth retentionReauthenticator,
	logger zerolog.Logger,
) *AdminEmergencyCleanupHandler {
	return &AdminEmergencyCleanupHandler{
		members: members, maintenance: maintenance, planner: planner, pressure: pressure,
		reauth: reauth, logger: logger,
	}
}

func (handler *AdminEmergencyCleanupHandler) Preview(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionManageSettings)
	if !ok {
		return
	}
	snapshot, err := handler.activeSnapshot()
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 8*time.Second)
	defer cancel()
	plan, err := handler.planner.Plan(ctx, snapshot)
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	preview, err := handler.maintenance.CreatePreview(request.Context(), principal.UserID, plan)
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, emergencyCleanupPreviewToResponse(preview))
}

func (handler *AdminEmergencyCleanupHandler) CreateJob(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionDangerousChanges)
	if !ok {
		return
	}
	var payload emergencyCleanupJobRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if payload.PreviewToken == "" || payload.CurrentPassword == "" ||
		payload.Confirmation != emergencyCleanupConfirmation {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Preview token, exact confirmation phrase, and current password are required.")
		return
	}
	if _, err := handler.activeSnapshot(); err != nil {
		handler.writeError(writer, request, err)
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
	job, err := handler.maintenance.CreateJob(request.Context(), principal.UserID, payload.PreviewToken)
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusAccepted, emergencyCleanupJobToResponse(job))
}

func (handler *AdminEmergencyCleanupHandler) LatestJob(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorize(writer, request, auth.InstanceActionRead); !ok {
		return
	}
	job, found, err := handler.maintenance.Latest(request.Context())
	if err != nil {
		handler.writeError(writer, request, err)
		return
	}
	if !found {
		writeJSON(writer, http.StatusOK, map[string]any{"job": nil})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"job": emergencyCleanupJobToResponse(job)})
}

func (handler *AdminEmergencyCleanupHandler) activeSnapshot() (storagepressure.Snapshot, error) {
	snapshot := handler.pressure.Snapshot()
	if !snapshot.ProbeSuccessful || snapshot.CapacityBytes == 0 {
		return storagepressure.Snapshot{}, ErrEmergencyCleanupProbeFailed
	}
	usedPercent := float64(snapshot.UsedBytes) / float64(snapshot.CapacityBytes) * 100
	if usedPercent < emergencyCleanupTargetUsedPercent || snapshot.Mode == "normal" {
		return storagepressure.Snapshot{}, ErrEmergencyCleanupUnavailable
	}
	return snapshot, nil
}

func (handler *AdminEmergencyCleanupHandler) authorize(
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
	if err != nil || auth.AuthorizeInstance(role, action) != nil {
		if err == nil {
			err = metadata.ErrForbidden
		}
		writeControlPlaneError(writer, request, handler.logger, err)
		return auth.Principal{}, false
	}
	return principal, true
}

func (handler *AdminEmergencyCleanupHandler) writeError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, ErrEmergencyCleanupUnavailable):
		httpx.WriteError(writer, request, http.StatusConflict, "STORAGE_PRESSURE_NOT_ACTIVE", "Storage is already below the emergency cleanup threshold.")
	case errors.Is(err, ErrEmergencyCleanupProbeFailed):
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "STORAGE_CAPACITY_UNAVAILABLE", "Storage capacity could not be measured safely.")
	case errors.Is(err, ErrNoEmergencyCleanupCandidates):
		httpx.WriteError(writer, request, http.StatusConflict, "NO_SAFE_CLEANUP_CANDIDATES", "No complete old month can be deleted without touching the protected recent-data window.")
	case errors.Is(err, metadata.ErrInvalidEmergencyPreview):
		httpx.WriteError(writer, request, http.StatusConflict, "EMERGENCY_PREVIEW_EXPIRED", "The cleanup preview expired or was already used. Generate it again.")
	case errors.Is(err, metadata.ErrEmergencyCleanupRunning):
		httpx.WriteError(writer, request, http.StatusConflict, "EMERGENCY_CLEANUP_RUNNING", "Another emergency cleanup is already running.")
	default:
		writeControlPlaneError(writer, request, handler.logger, err)
	}
}

func emergencyCleanupPreviewToResponse(preview metadata.EmergencyCleanupPreview) emergencyCleanupPreviewResponse {
	groups := make(map[string]emergencyCleanupGroupResponse)
	for _, step := range preview.Plan.Steps {
		key := fmt.Sprintf("%s:%d", step.ProjectID, step.Month)
		group, exists := groups[key]
		if !exists {
			group = emergencyCleanupGroupResponse{
				ProjectID: step.ProjectID.String(), ProjectName: step.ProjectName, Month: step.Month,
				OldestAt: step.OldestAt.UTC().Format(timeFormat), NewestAt: step.NewestAt.UTC().Format(timeFormat),
			}
		}
		group.AffectedRows += step.AffectedRows
		group.EstimatedBytes += step.EstimatedBytes
		if step.OldestAt.Before(parseResponseTime(group.OldestAt)) {
			group.OldestAt = step.OldestAt.UTC().Format(timeFormat)
		}
		if step.NewestAt.After(parseResponseTime(group.NewestAt)) {
			group.NewestAt = step.NewestAt.UTC().Format(timeFormat)
		}
		groups[key] = group
	}
	groupList := make([]emergencyCleanupGroupResponse, 0, len(groups))
	for _, group := range groups {
		groupList = append(groupList, group)
	}
	sort.Slice(groupList, func(left, right int) bool {
		if groupList[left].Month == groupList[right].Month {
			return groupList[left].ProjectName < groupList[right].ProjectName
		}
		return groupList[left].Month < groupList[right].Month
	})
	return emergencyCleanupPreviewResponse{
		PreviewToken: preview.Token, ExpiresAt: preview.ExpiresAt.UTC().Format(timeFormat),
		UsedBytes: preview.Plan.UsedBytes, CapacityBytes: preview.Plan.CapacityBytes,
		EstimatedReleaseBytes: preview.Plan.EstimatedReleaseBytes,
		ProjectedUsedBytes:    preview.Plan.ProjectedUsedBytes,
		TargetUsedPercent:     preview.Plan.TargetUsedPercent,
		ProtectedAfter:        preview.Plan.ProtectedAfter.UTC().Format(timeFormat),
		CanReachTarget:        preview.Plan.CanReachTarget, Groups: groupList,
	}
}

func parseResponseTime(value string) time.Time {
	parsed, _ := time.Parse(timeFormat, value)
	return parsed
}

func emergencyCleanupJobToResponse(job metadata.EmergencyCleanupJob) emergencyCleanupJobResponse {
	response := emergencyCleanupJobResponse{
		ID: job.ID.String(), Status: job.Status, UsedBytesBefore: job.UsedBytesBefore,
		CapacityBytes: job.CapacityBytes, EstimatedReleaseBytes: job.EstimatedReleaseBytes,
		TargetUsedPercent: job.TargetUsedPercent, ProtectedAfter: job.ProtectedAfter.UTC().Format(timeFormat),
		CanReachTarget: job.CanReachTarget, TotalSteps: job.TotalSteps, CompletedSteps: job.CompletedSteps,
		Attempts: job.Attempts, LastError: job.LastError, CreatedAt: job.CreatedAt.UTC().Format(timeFormat),
		UpdatedAt: job.UpdatedAt.UTC().Format(timeFormat),
	}
	if job.StartedAt != nil {
		value := job.StartedAt.UTC().Format(timeFormat)
		response.StartedAt = &value
	}
	if job.CompletedAt != nil {
		value := job.CompletedAt.UTC().Format(timeFormat)
		response.CompletedAt = &value
	}
	return response
}

type SQLEmergencyCleanupPlanner struct {
	postgres   *sql.DB
	clickHouse *sql.DB
	now        func() time.Time
}

func NewSQLEmergencyCleanupPlanner(postgres, clickHouse *sql.DB) *SQLEmergencyCleanupPlanner {
	return &SQLEmergencyCleanupPlanner{postgres: postgres, clickHouse: clickHouse, now: time.Now}
}

func (planner *SQLEmergencyCleanupPlanner) Plan(
	ctx context.Context,
	snapshot storagepressure.Snapshot,
) (metadata.EmergencyCleanupPlan, error) {
	protectedAfter := planner.now().UTC().Add(-emergencyCleanupRecentDataFloor)
	projectNames, err := planner.projectNames(ctx)
	if err != nil {
		return metadata.EmergencyCleanupPlan{}, err
	}
	rows, err := planner.clickHouse.QueryContext(ctx, `SELECT table,
		toUInt32(extract(partition, '^\\(([0-9]{6}),')) AS month_key,
		toUUID(extract(partition, '\\x27([0-9a-f-]{36})\\x27')) AS project_id,
		partition_id,sum(rows),sum(bytes_on_disk),min(min_time),max(max_time)
		FROM system.parts
		WHERE database=currentDatabase() AND active AND table IN
		('event_stack_mappings_local','behavior_metrics_1m_local','measurement_metrics_1m_local',
		 'usage_metrics_1h_local','usage_records_local','api_metrics_1m_local',
		 'issue_metrics_5m_local','project_metrics_1m_local','rum_events_local')
		GROUP BY table,partition,partition_id ORDER BY min(min_time),project_id,table`)
	if err != nil {
		return metadata.EmergencyCleanupPlan{}, fmt.Errorf("list emergency cleanup partitions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	type candidateGroup struct {
		month    int
		project  uuid.UUID
		newestAt time.Time
		steps    []metadata.EmergencyCleanupStep
	}
	groups := make(map[string]*candidateGroup)
	for rows.Next() {
		var step metadata.EmergencyCleanupStep
		if err := rows.Scan(&step.Table, &step.Month, &step.ProjectID, &step.PartitionID,
			&step.AffectedRows, &step.EstimatedBytes, &step.OldestAt, &step.NewestAt); err != nil {
			return metadata.EmergencyCleanupPlan{}, err
		}
		name, exists := projectNames[step.ProjectID]
		if !exists {
			continue
		}
		step.ProjectName = name
		step.OldestAt, step.NewestAt = step.OldestAt.UTC(), step.NewestAt.UTC()
		key := fmt.Sprintf("%s:%d", step.ProjectID, step.Month)
		group := groups[key]
		if group == nil {
			group = &candidateGroup{month: step.Month, project: step.ProjectID}
			groups[key] = group
		}
		if step.NewestAt.After(group.newestAt) {
			group.newestAt = step.NewestAt
		}
		group.steps = append(group.steps, step)
	}
	if err := rows.Err(); err != nil {
		return metadata.EmergencyCleanupPlan{}, err
	}
	ordered := make([]*candidateGroup, 0, len(groups))
	for _, group := range groups {
		// A quiet current month is still an open partition and can receive new
		// events after this preview. Only closed calendar months are safe here.
		if monthEnd, ok := emergencyCleanupMonthEnd(group.month); ok && !monthEnd.After(protectedAfter) &&
			!group.newestAt.After(protectedAfter) {
			ordered = append(ordered, group)
		}
	}
	sort.Slice(ordered, func(left, right int) bool {
		if ordered[left].month == ordered[right].month {
			return ordered[left].project.String() < ordered[right].project.String()
		}
		return ordered[left].month < ordered[right].month
	})
	if len(ordered) == 0 {
		return metadata.EmergencyCleanupPlan{}, ErrNoEmergencyCleanupCandidates
	}
	targetBytes := uint64(float64(snapshot.CapacityBytes) * emergencyCleanupTargetUsedPercent / 100)
	plan := metadata.EmergencyCleanupPlan{
		UsedBytes: snapshot.UsedBytes, CapacityBytes: snapshot.CapacityBytes,
		TargetUsedPercent: emergencyCleanupTargetUsedPercent, ProtectedAfter: protectedAfter,
	}
	for _, group := range ordered {
		plan.Steps = append(plan.Steps, group.steps...)
		for _, step := range group.steps {
			plan.EstimatedReleaseBytes += step.EstimatedBytes
		}
		if snapshot.UsedBytes-min(snapshot.UsedBytes, plan.EstimatedReleaseBytes) <= targetBytes {
			break
		}
	}
	plan.ProjectedUsedBytes = snapshot.UsedBytes - min(snapshot.UsedBytes, plan.EstimatedReleaseBytes)
	plan.CanReachTarget = plan.ProjectedUsedBytes <= targetBytes
	return plan, nil
}

func emergencyCleanupMonthEnd(monthKey int) (time.Time, bool) {
	year, month := monthKey/100, time.Month(monthKey%100)
	if year < 2000 || month < time.January || month > time.December {
		return time.Time{}, false
	}
	return time.Date(year, month, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 1, 0), true
}

func (planner *SQLEmergencyCleanupPlanner) projectNames(ctx context.Context) (map[uuid.UUID]string, error) {
	rows, err := planner.postgres.QueryContext(ctx, `SELECT id,name FROM projects WHERE status<>'deleting'`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	names := make(map[uuid.UUID]string)
	for rows.Next() {
		var id uuid.UUID
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		names[id] = name
	}
	return names, rows.Err()
}
