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
	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type retentionMaintenanceFixture struct {
	preview metadata.RetentionPreview
	job     metadata.MaintenanceJob
	err     error
	created bool
}

func (fixture *retentionMaintenanceFixture) CreateRetentionPreview(_ context.Context, _ uuid.UUID, plan metadata.RetentionPlan) (metadata.RetentionPreview, error) {
	if fixture.err != nil {
		return metadata.RetentionPreview{}, fixture.err
	}
	fixture.preview.Plan = plan
	return fixture.preview, nil
}
func (fixture *retentionMaintenanceFixture) CreateRetentionJob(context.Context, uuid.UUID, string) (metadata.MaintenanceJob, error) {
	fixture.created = true
	return fixture.job, fixture.err
}
func (fixture *retentionMaintenanceFixture) List(context.Context, int) ([]metadata.MaintenanceJob, error) {
	return []metadata.MaintenanceJob{fixture.job}, fixture.err
}

type retentionPolicyFixture struct {
	policy metadata.ProjectRetentionPolicy
	err    error
}

func (fixture retentionPolicyFixture) GetRetentionPolicy(context.Context, uuid.UUID, []config.SystemSettingDefinition) (metadata.ProjectRetentionPolicy, error) {
	return fixture.policy, fixture.err
}

type retentionPreviewFixture struct {
	plan metadata.RetentionPlan
	err  error
}

func (fixture retentionPreviewFixture) Plan(context.Context, uuid.UUID, int, int) (metadata.RetentionPlan, error) {
	return fixture.plan, fixture.err
}

type retentionReauthFixture struct{ err error }

func (fixture retentionReauthFixture) Elevate(context.Context, auth.Principal, string) error {
	return fixture.err
}

func (fixture retentionReauthFixture) RequireRecentElevation(context.Context, auth.Principal, time.Duration) error {
	return fixture.err
}

func TestAdminRetentionPreviewBindsEffectivePolicyAndImpact(t *testing.T) {
	ownerID, projectID := uuid.New(), uuid.New()
	plan := metadata.RetentionPlan{
		ProjectID: projectID, RawDays: 7, AggregateDays: 120, AffectedRows: 42, DeleteRows: 12,
		Steps: []metadata.RetentionPlanStep{{Table: "rum_events_local", TimeColumn: "timestamp", Month: 202608, RetentionDays: 7, AffectedRows: 42, DeleteRows: 12}},
	}
	maintenance := &retentionMaintenanceFixture{preview: metadata.RetentionPreview{Token: "orrp_preview", ExpiresAt: time.Now().UTC().Add(time.Minute)}}
	router := adminRetentionTestRouter(ownerID, metadata.InstanceRoleOwner, maintenance,
		retentionPolicyFixture{policy: metadata.ProjectRetentionPolicy{RawDays: 7, AggregateDays: 120}},
		retentionPreviewFixture{plan: plan}, retentionReauthFixture{})
	response := performRetentionRequest(router, http.MethodPost, "/api/v1/admin/retention-policy/preview",
		`{"projectId":"`+projectID.String()+`","rawDays":7,"aggregateDays":120}`, true)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"affectedRows":42`) ||
		!strings.Contains(response.Body.String(), `"cannotRestoreDeletedData":true`) || maintenance.preview.Plan.ProjectID != projectID {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminRetentionRejectsPolicyDriftAndRequiresOwnerReauthentication(t *testing.T) {
	ownerID, projectID := uuid.New(), uuid.New()
	maintenance := &retentionMaintenanceFixture{}
	router := adminRetentionTestRouter(ownerID, metadata.InstanceRoleOwner, maintenance,
		retentionPolicyFixture{policy: metadata.ProjectRetentionPolicy{RawDays: 14, AggregateDays: 90}},
		retentionPreviewFixture{}, retentionReauthFixture{})
	response := performRetentionRequest(router, http.MethodPost, "/api/v1/admin/retention-policy/preview",
		`{"projectId":"`+projectID.String()+`","rawDays":7,"aggregateDays":90}`, true)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "RETENTION_POLICY_CHANGED") {
		t.Fatalf("drift status=%d body=%s", response.Code, response.Body.String())
	}

	router = adminRetentionTestRouter(ownerID, metadata.InstanceRoleOwner, maintenance, retentionPolicyFixture{},
		retentionPreviewFixture{}, retentionReauthFixture{err: auth.ErrInvalidCredentials})
	response = performRetentionRequest(router, http.MethodPost, "/api/v1/admin/retention-jobs",
		`{"previewToken":"orrp_preview","currentPassword":"wrong"}`, true)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "REAUTHENTICATION_FAILED") || maintenance.created {
		t.Fatalf("reauth status=%d created=%v body=%s", response.Code, maintenance.created, response.Body.String())
	}

	adminID := uuid.New()
	router = adminRetentionTestRouter(adminID, metadata.InstanceRoleAdmin, maintenance, retentionPolicyFixture{}, retentionPreviewFixture{}, retentionReauthFixture{})
	response = performRetentionRequest(router, http.MethodPost, "/api/v1/admin/retention-jobs",
		`{"previewToken":"orrp_preview","currentPassword":"password"}`, true)
	if response.Code != http.StatusForbidden {
		t.Fatalf("admin dangerous change status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminRetentionCreatesAndListsObservableJob(t *testing.T) {
	ownerID, projectID, jobID := uuid.New(), uuid.New(), uuid.New()
	now := time.Now().UTC()
	maintenance := &retentionMaintenanceFixture{job: metadata.MaintenanceJob{
		ID: jobID, Type: "retention_cleanup", Status: "queued", ProjectID: projectID, RawDays: 7,
		AggregateDays: 90, AffectedRows: 100, DeleteRows: 20, TotalSteps: 3, CompletedSteps: 1,
		CreatedAt: now, UpdatedAt: now,
	}}
	router := adminRetentionTestRouter(ownerID, metadata.InstanceRoleOwner, maintenance, retentionPolicyFixture{}, retentionPreviewFixture{}, retentionReauthFixture{})
	response := performRetentionRequest(router, http.MethodPost, "/api/v1/admin/retention-jobs",
		`{"previewToken":"orrp_preview","currentPassword":"correct-password"}`, true)
	if response.Code != http.StatusAccepted || !strings.Contains(response.Body.String(), `"totalSteps":3`) || !maintenance.created {
		t.Fatalf("create status=%d body=%s", response.Code, response.Body.String())
	}
	response = performRetentionRequest(router, http.MethodGet, "/api/v1/admin/maintenance-jobs", "", false)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), jobID.String()) ||
		!strings.Contains(response.Body.String(), `"completedSteps":1`) {
		t.Fatalf("list status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminRetentionMapsExpiredPreview(t *testing.T) {
	ownerID := uuid.New()
	maintenance := &retentionMaintenanceFixture{err: metadata.ErrInvalidPreviewToken}
	router := adminRetentionTestRouter(ownerID, metadata.InstanceRoleOwner, maintenance, retentionPolicyFixture{}, retentionPreviewFixture{}, retentionReauthFixture{})
	response := performRetentionRequest(router, http.MethodPost, "/api/v1/admin/retention-jobs",
		`{"previewToken":"orrp_expired","currentPassword":"correct-password"}`, true)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "RETENTION_PREVIEW_EXPIRED") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func adminRetentionTestRouter(
	userID uuid.UUID,
	role metadata.InstanceRole,
	maintenance retentionMaintenance,
	policies retentionPolicyReader,
	preview RetentionPreviewSource,
	reauth retentionReauthenticator,
) http.Handler {
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{userID: role}}
	handler := NewAdminRetentionHandler(members, maintenance, policies, preview, reauth, testSystemSettingDefinitions(), zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	requireSession := httpx.RequireSession(adminAuthenticator{principals: map[string]auth.Principal{"session": {UserID: userID}}})
	baseURL, _ := url.Parse("http://openrum.test")
	requireCSRF := httpx.RequireCSRF(baseURL)
	router.Handle("POST /api/v1/admin/retention-policy/preview", requireSession(requireCSRF(http.HandlerFunc(handler.Preview))))
	router.Handle("POST /api/v1/admin/retention-jobs", requireSession(requireCSRF(http.HandlerFunc(handler.CreateJob))))
	router.Handle("GET /api/v1/admin/maintenance-jobs", requireSession(http.HandlerFunc(handler.ListJobs)))
	return router
}

func performRetentionRequest(router http.Handler, method, path, body string, csrf bool) *httptest.ResponseRecorder {
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
