package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/storagepressure"
)

type emergencyCleanupMaintenanceFixture struct {
	preview metadata.EmergencyCleanupPreview
	job     metadata.EmergencyCleanupJob
	err     error
	created bool
}

func (fixture *emergencyCleanupMaintenanceFixture) CreatePreview(
	_ context.Context,
	_ uuid.UUID,
	plan metadata.EmergencyCleanupPlan,
) (metadata.EmergencyCleanupPreview, error) {
	fixture.preview.Plan = plan
	return fixture.preview, fixture.err
}

func (fixture *emergencyCleanupMaintenanceFixture) CreateJob(
	context.Context,
	uuid.UUID,
	string,
) (metadata.EmergencyCleanupJob, error) {
	fixture.created = true
	return fixture.job, fixture.err
}

func (fixture *emergencyCleanupMaintenanceFixture) Latest(context.Context) (metadata.EmergencyCleanupJob, bool, error) {
	return fixture.job, fixture.job.ID != uuid.Nil, fixture.err
}

type emergencyCleanupPlannerFixture struct {
	plan metadata.EmergencyCleanupPlan
	err  error
}

func (fixture emergencyCleanupPlannerFixture) Plan(
	context.Context,
	storagepressure.Snapshot,
) (metadata.EmergencyCleanupPlan, error) {
	return fixture.plan, fixture.err
}

type emergencyPressureFixture struct{ snapshot storagepressure.Snapshot }

func (fixture emergencyPressureFixture) Snapshot() storagepressure.Snapshot { return fixture.snapshot }

func TestEmergencyCleanupPreviewExplainsRecommendedOldMonths(t *testing.T) {
	ownerID, projectID := uuid.New(), uuid.New()
	now := time.Now().UTC().Truncate(time.Second)
	plan := metadata.EmergencyCleanupPlan{
		UsedBytes: 96, CapacityBytes: 100, EstimatedReleaseBytes: 12, ProjectedUsedBytes: 84,
		TargetUsedPercent: 85, ProtectedAfter: now.Add(-24 * time.Hour), CanReachTarget: true,
		Steps: []metadata.EmergencyCleanupStep{
			{ProjectID: projectID, ProjectName: "Storefront", Table: "rum_events_local", Month: 202608,
				PartitionID: strings.Repeat("a", 32), AffectedRows: 40, EstimatedBytes: 10,
				OldestAt: now.Add(-60 * 24 * time.Hour), NewestAt: now.Add(-40 * 24 * time.Hour)},
			{ProjectID: projectID, ProjectName: "Storefront", Table: "api_metrics_1m_local", Month: 202608,
				PartitionID: strings.Repeat("a", 32), AffectedRows: 20, EstimatedBytes: 2,
				OldestAt: now.Add(-60 * 24 * time.Hour), NewestAt: now.Add(-40 * 24 * time.Hour)},
		},
	}
	maintenance := &emergencyCleanupMaintenanceFixture{preview: metadata.EmergencyCleanupPreview{
		Token: "orec_preview", ExpiresAt: now.Add(time.Minute),
	}}
	router := emergencyCleanupTestRouter(ownerID, metadata.InstanceRoleOwner, maintenance,
		emergencyCleanupPlannerFixture{plan: plan}, blockedPressure(), retentionReauthFixture{})
	response := performEmergencyCleanupRequest(router, http.MethodPost, "/api/v1/admin/emergency-cleanup/preview", "", true)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"canReachTarget":true`) ||
		!strings.Contains(response.Body.String(), `"projectName":"Storefront"`) ||
		!strings.Contains(response.Body.String(), `"estimatedBytes":12`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEmergencyCleanupRequiresPressureAndOwnerConfirmation(t *testing.T) {
	ownerID := uuid.New()
	maintenance := &emergencyCleanupMaintenanceFixture{}
	router := emergencyCleanupTestRouter(ownerID, metadata.InstanceRoleOwner, maintenance,
		emergencyCleanupPlannerFixture{}, emergencyPressureFixture{snapshot: storagepressure.Snapshot{
			Mode: "normal", ProbeSuccessful: true, UsedBytes: 80, CapacityBytes: 100,
		}}, retentionReauthFixture{})
	response := performEmergencyCleanupRequest(router, http.MethodPost, "/api/v1/admin/emergency-cleanup/preview", "", true)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "STORAGE_PRESSURE_NOT_ACTIVE") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	adminID := uuid.New()
	router = emergencyCleanupTestRouter(adminID, metadata.InstanceRoleAdmin, maintenance,
		emergencyCleanupPlannerFixture{}, blockedPressure(), retentionReauthFixture{})
	response = performEmergencyCleanupRequest(router, http.MethodPost, "/api/v1/admin/emergency-cleanup/jobs",
		`{"previewToken":"orec_preview","confirmation":"清理旧数据","currentPassword":"password"}`, true)
	if response.Code != http.StatusForbidden || maintenance.created {
		t.Fatalf("status=%d created=%v body=%s", response.Code, maintenance.created, response.Body.String())
	}
}

func TestEmergencyCleanupCreatesObservableJob(t *testing.T) {
	ownerID, jobID := uuid.New(), uuid.New()
	now := time.Now().UTC()
	maintenance := &emergencyCleanupMaintenanceFixture{job: metadata.EmergencyCleanupJob{
		ID: jobID, Status: "queued", UsedBytesBefore: 96, CapacityBytes: 100,
		EstimatedReleaseBytes: 12, TargetUsedPercent: 85, ProtectedAfter: now.Add(-24 * time.Hour),
		CanReachTarget: true, TotalSteps: 2, CreatedAt: now, UpdatedAt: now,
	}}
	router := emergencyCleanupTestRouter(ownerID, metadata.InstanceRoleOwner, maintenance,
		emergencyCleanupPlannerFixture{}, blockedPressure(), retentionReauthFixture{})
	response := performEmergencyCleanupRequest(router, http.MethodPost, "/api/v1/admin/emergency-cleanup/jobs",
		`{"previewToken":"orec_preview","confirmation":"清理旧数据","currentPassword":"password"}`, true)
	if response.Code != http.StatusAccepted || !maintenance.created ||
		!strings.Contains(response.Body.String(), `"estimatedReleaseBytes":12`) {
		t.Fatalf("status=%d created=%v body=%s", response.Code, maintenance.created, response.Body.String())
	}
	response = performEmergencyCleanupRequest(router, http.MethodGet, "/api/v1/admin/emergency-cleanup/jobs/latest", "", false)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), jobID.String()) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEmergencyCleanupRejectsMissingConfirmationPhrase(t *testing.T) {
	ownerID := uuid.New()
	maintenance := &emergencyCleanupMaintenanceFixture{}
	router := emergencyCleanupTestRouter(ownerID, metadata.InstanceRoleOwner, maintenance,
		emergencyCleanupPlannerFixture{}, blockedPressure(), retentionReauthFixture{})
	response := performEmergencyCleanupRequest(router, http.MethodPost, "/api/v1/admin/emergency-cleanup/jobs",
		`{"previewToken":"orec_preview","currentPassword":"password"}`, true)
	if response.Code != http.StatusBadRequest || maintenance.created {
		t.Fatalf("status=%d created=%v body=%s", response.Code, maintenance.created, response.Body.String())
	}
}

func TestEmergencyCleanupMonthEndRejectsOpenAndInvalidMonths(t *testing.T) {
	end, ok := emergencyCleanupMonthEnd(202608)
	if !ok || !end.Equal(time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("end=%s ok=%v", end, ok)
	}
	if _, ok := emergencyCleanupMonthEnd(202613); ok {
		t.Fatal("invalid month should be rejected")
	}

	protectedAfter := time.Date(2026, time.September, 15, 0, 0, 0, 0, time.UTC)
	augustEnd, _ := emergencyCleanupMonthEnd(202608)
	septemberEnd, _ := emergencyCleanupMonthEnd(202609)
	if augustEnd.After(protectedAfter) || !septemberEnd.After(protectedAfter) {
		t.Fatal("only calendar months closed before the protected boundary are eligible")
	}
}

func blockedPressure() emergencyPressureFixture {
	return emergencyPressureFixture{snapshot: storagepressure.Snapshot{
		Mode: "blocked", Level: "critical", ProbeSuccessful: true, IngestBlocked: true,
		UsedBytes: 96, CapacityBytes: 100, FreeBytes: 4, FreeRatio: 0.04,
	}}
}

func emergencyCleanupTestRouter(
	userID uuid.UUID,
	role metadata.InstanceRole,
	maintenance emergencyCleanupMaintenance,
	planner EmergencyCleanupPlanner,
	pressure storagePressureSnapshotter,
	reauth retentionReauthenticator,
) http.Handler {
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{userID: role}}
	handler := NewAdminEmergencyCleanupHandler(members, maintenance, planner, pressure, reauth, zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	requireSession := httpx.RequireSession(adminAuthenticator{principals: map[string]auth.Principal{"session": {UserID: userID}}})
	baseURL, _ := url.Parse("http://openrum.test")
	requireCSRF := httpx.RequireCSRF(baseURL)
	router.Handle("POST /api/v1/admin/emergency-cleanup/preview", requireSession(requireCSRF(http.HandlerFunc(handler.Preview))))
	router.Handle("POST /api/v1/admin/emergency-cleanup/jobs", requireSession(requireCSRF(http.HandlerFunc(handler.CreateJob))))
	router.Handle("GET /api/v1/admin/emergency-cleanup/jobs/latest", requireSession(http.HandlerFunc(handler.LatestJob)))
	return router
}

func performEmergencyCleanupRequest(router http.Handler, method, path, body string, csrf bool) *httptest.ResponseRecorder {
	request := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	request.Host = "openrum.test"
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	if csrf {
		request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "csrf"})
		request.Header.Set("X-CSRF-Token", "csrf")
		request.Header.Set("Origin", "http://openrum.test")
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
