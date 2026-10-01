package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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
	"openrum/internal/sourcemap"
)

type fakeReleaseRepo struct {
	release         metadata.Release
	existingRelease bool
	artifact        metadata.SourceMapArtifact
	byName          *metadata.SourceMapArtifact
	artifacts       []metadata.SourceMapArtifact
	status          metadata.SourceMapArtifactStatus
	listOptions     metadata.ReleaseListOptions
	listErr         error
	removed         []uuid.UUID
	deletedRelease  uuid.UUID
	calls           int
}

func (repo *fakeReleaseRepo) CreateReleaseForActor(_ context.Context, _ uuid.UUID, release metadata.Release) (metadata.Release, bool, error) {
	if repo.existingRelease {
		return repo.release, false, nil
	}
	release.ID = uuid.New()
	repo.release, repo.existingRelease = release, true
	return release, true, nil
}
func (repo *fakeReleaseRepo) GetRelease(_ context.Context, projectID, releaseID uuid.UUID) (metadata.Release, error) {
	return metadata.Release{ID: releaseID, ProjectID: projectID, Version: "web@1.0.0", Dist: "browser"}, nil
}
func (repo *fakeReleaseRepo) ListReleases(_ context.Context, projectID uuid.UUID, options metadata.ReleaseListOptions) (metadata.ReleasePage, error) {
	repo.listOptions = options
	if repo.listErr != nil {
		return metadata.ReleasePage{}, repo.listErr
	}
	return metadata.ReleasePage{Releases: []metadata.Release{{ID: uuid.New(), ProjectID: projectID, Version: "web@1.0.0"}}}, nil
}
func (repo *fakeReleaseRepo) DeleteRelease(_ context.Context, _, _, releaseID uuid.UUID) error {
	repo.deletedRelease = releaseID
	return nil
}
func (repo *fakeReleaseRepo) CreateArtifact(_ context.Context, artifact metadata.SourceMapArtifact) (metadata.SourceMapArtifact, error) {
	repo.artifact = artifact
	return artifact, nil
}
func (repo *fakeReleaseRepo) GetArtifact(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (metadata.SourceMapArtifact, error) {
	return repo.artifact, nil
}
func (repo *fakeReleaseRepo) GetArtifactByName(context.Context, uuid.UUID, uuid.UUID, string) (metadata.SourceMapArtifact, error) {
	if repo.byName == nil {
		return metadata.SourceMapArtifact{}, metadata.ErrNotFound
	}
	return *repo.byName, nil
}
func (repo *fakeReleaseRepo) ListArtifacts(context.Context, uuid.UUID, uuid.UUID) ([]metadata.SourceMapArtifact, error) {
	if repo.artifacts != nil {
		return repo.artifacts, nil
	}
	return []metadata.SourceMapArtifact{repo.artifact}, nil
}
func (repo *fakeReleaseRepo) SetArtifactStatus(_ context.Context, _, _, _ uuid.UUID, status metadata.SourceMapArtifactStatus, _ *string) (metadata.SourceMapArtifact, error) {
	repo.status = status
	repo.artifact.Status = status
	return repo.artifact, nil
}
func (repo *fakeReleaseRepo) DeleteArtifact(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error {
	repo.calls++
	return nil
}
func (repo *fakeReleaseRepo) RemoveArtifact(_ context.Context, _, _, artifactID uuid.UUID) error {
	repo.removed = append(repo.removed, artifactID)
	return nil
}

type fakeSourceMapStorage struct {
	grant       sourcemap.UploadGrant
	object      sourcemap.ObjectInfo
	headErr     error
	presignTTL  time.Duration
	presignSize int64
	presigns    int
	deleted     []string
	deleteErr   error
}

func (storage *fakeSourceMapStorage) PresignUpload(_ context.Context, _ string, size int64, _ []byte, ttl time.Duration) (sourcemap.UploadGrant, error) {
	storage.presignTTL, storage.presignSize = ttl, size
	storage.presigns++
	return storage.grant, nil
}
func (storage *fakeSourceMapStorage) Head(context.Context, string) (sourcemap.ObjectInfo, error) {
	return storage.object, storage.headErr
}
func (storage *fakeSourceMapStorage) Delete(_ context.Context, key string) error {
	storage.deleted = append(storage.deleted, key)
	return storage.deleteErr
}

// forbiddenStorageError is a provider 403, as returned for a credential that may
// write and read but not delete.
type forbiddenStorageError struct{}

func (forbiddenStorageError) Error() string       { return "AccessDenied" }
func (forbiddenStorageError) HTTPStatusCode() int { return http.StatusForbidden }
func (storage *fakeSourceMapStorage) Read(context.Context, string, int64) ([]byte, error) {
	return nil, nil
}

type fakeRemapQueue struct{ queued []string }

func (queue *fakeRemapQueue) Queue(_ context.Context, _ uuid.UUID, version, dist string) error {
	queue.queued = append(queue.queued, version+"|"+dist)
	return nil
}

type fakeUploadTokens struct{ access metadata.UploadTokenAccess }

func (tokens fakeUploadTokens) Authenticate(_ context.Context, secret string) (metadata.UploadTokenAccess, error) {
	if secret != "orut_valid" {
		return metadata.UploadTokenAccess{}, metadata.ErrInvalidUploadToken
	}
	return tokens.access, nil
}

type releaseFixture struct {
	userID, projectID, releaseID uuid.UUID
	repo                         *fakeReleaseRepo
	storage                      *fakeSourceMapStorage
	remaps                       *fakeRemapQueue
	router                       http.Handler
}

func newReleaseFixture(t *testing.T, role metadata.OrganizationRole, storage sourcemap.Storage) *releaseFixture {
	t.Helper()
	fixture := &releaseFixture{userID: uuid.New(), projectID: uuid.New(), releaseID: uuid.New(), repo: &fakeReleaseRepo{}, remaps: &fakeRemapQueue{}}
	if memory, ok := storage.(*fakeSourceMapStorage); ok {
		fixture.storage = memory
	}
	handler := NewReleaseHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: role}}, fixture.repo, storage, fixture.remaps, zerolog.Nop())
	baseURL, _ := url.Parse("http://openrum.test")
	guard := httpx.RequireSessionOrUploadToken(connectionFixtureAuthenticator{principal: auth.Principal{UserID: fixture.userID}},
		fakeUploadTokens{access: metadata.UploadTokenAccess{TokenID: uuid.New(), ProjectID: fixture.projectID}}, baseURL)
	router := httpx.NewRouter(zerolog.Nop())
	router.Handle("POST /api/v1/projects/{projectId}/releases", guard(http.HandlerFunc(handler.Create)))
	router.Handle("GET /api/v1/projects/{projectId}/releases", guard(http.HandlerFunc(handler.ListReleases)))
	router.Handle("DELETE /api/v1/projects/{projectId}/releases/{releaseId}", guard(http.HandlerFunc(handler.DeleteRelease)))
	router.Handle("POST /api/v1/projects/{projectId}/releases/{releaseId}/artifacts/presign", guard(http.HandlerFunc(handler.Presign)))
	router.Handle("POST /api/v1/projects/{projectId}/releases/{releaseId}/artifacts/{artifactId}/complete", guard(http.HandlerFunc(handler.Complete)))
	router.Handle("DELETE /api/v1/projects/{projectId}/releases/{releaseId}/artifacts/{artifactId}", guard(http.HandlerFunc(handler.Delete)))
	router.Handle("GET /api/v1/projects/{projectId}/sourcemaps/status", httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: fixture.userID}})(http.HandlerFunc(handler.SourceMapStatus)))
	fixture.router = router
	return fixture
}

// session sends a Console request with the cookies and headers CSRF requires.
func (fixture *releaseFixture) session(method, target, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "csrf"})
	request.Header.Set(httpx.CSRFHeader, "csrf")
	request.Header.Set("Origin", "http://openrum.test")
	response := httptest.NewRecorder()
	fixture.router.ServeHTTP(response, request)
	return response
}

func (fixture *releaseFixture) token(method, target, body, token string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	fixture.router.ServeHTTP(response, request)
	return response
}

func (fixture *releaseFixture) url(suffix string) string {
	return releaseURL(fixture.projectID, fixture.releaseID, suffix)
}

func presignBody(contents string, extra string) string {
	digest := sha256.Sum256([]byte(contents))
	return `{"artifactName":"assets/app.js.map","sha256":"` + hex.EncodeToString(digest[:]) + `","sizeBytes":321` + extra + `}`
}

func TestReleasePresignReturnsBoundedGrant(t *testing.T) {
	expires := time.Now().UTC().Add(sourcemap.MaxPresignTTL)
	storage := &fakeSourceMapStorage{grant: sourcemap.UploadGrant{URL: "https://oss.example/upload", Method: http.MethodPut, Headers: map[string]string{"x-oss-meta-sha256": "abc"}, ExpiresAt: expires}}
	fixture := newReleaseFixture(t, metadata.RoleMember, storage)
	response := fixture.session(http.MethodPost, fixture.url("/artifacts/presign"), presignBody("map", ""))
	if response.Code != http.StatusCreated || storage.presignTTL != sourcemap.MaxPresignTTL || storage.presignSize != 321 ||
		!strings.Contains(response.Body.String(), "https://oss.example/upload") || !strings.Contains(response.Body.String(), `"skipped":false`) ||
		!strings.Contains(response.Body.String(), expires.Format("2006-01-02")) {
		t.Fatalf("status=%d ttl=%s size=%d body=%s", response.Code, storage.presignTTL, storage.presignSize, response.Body.String())
	}
}

func TestReleasePresignRejectsArtifactsAboveParserLimit(t *testing.T) {
	storage := &fakeSourceMapStorage{}
	fixture := newReleaseFixture(t, metadata.RoleMember, storage)
	digest := sha256.Sum256([]byte("map"))
	body := `{"artifactName":"app.js.map","sha256":"` + hex.EncodeToString(digest[:]) + `","sizeBytes":67108865}`
	response := fixture.session(http.MethodPost, fixture.url("/artifacts/presign"), body)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "ARTIFACT_TOO_LARGE") || !strings.Contains(response.Body.String(), "64 MiB") || storage.presigns != 0 {
		t.Fatalf("status=%d presigns=%d body=%s", response.Code, storage.presigns, response.Body.String())
	}
}

func TestReleasePresignSkipsIdenticalReadyArtifact(t *testing.T) {
	storage := &fakeSourceMapStorage{}
	fixture := newReleaseFixture(t, metadata.RoleMember, storage)
	digest := sha256.Sum256([]byte("map"))
	fixture.repo.byName = &metadata.SourceMapArtifact{ID: uuid.New(), Status: metadata.ArtifactStatusReady, SHA256: digest[:], OSSKey: "old"}
	response := fixture.session(http.MethodPost, fixture.url("/artifacts/presign"), presignBody("map", ""))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"skipped":true`) || storage.presigns != 0 || len(storage.deleted) != 0 {
		t.Fatalf("status=%d presigns=%d deleted=%v body=%s", response.Code, storage.presigns, storage.deleted, response.Body.String())
	}
}

func TestReleasePresignRequiresReplaceForChangedReadyArtifact(t *testing.T) {
	storage := &fakeSourceMapStorage{}
	fixture := newReleaseFixture(t, metadata.RoleMember, storage)
	oldID := uuid.New()
	fixture.repo.byName = &metadata.SourceMapArtifact{ID: oldID, Status: metadata.ArtifactStatusReady, SHA256: make([]byte, 32), OSSKey: "old-object"}
	response := fixture.session(http.MethodPost, fixture.url("/artifacts/presign"), presignBody("new", ""))
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "ARTIFACT_EXISTS") || storage.presigns != 0 {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	response = fixture.session(http.MethodPost, fixture.url("/artifacts/presign"), presignBody("new", `,"replace":true`))
	if response.Code != http.StatusCreated || storage.presigns != 1 || len(storage.deleted) != 1 || storage.deleted[0] != "old-object" ||
		len(fixture.repo.removed) != 1 || fixture.repo.removed[0] != oldID {
		t.Fatalf("status=%d deleted=%v removed=%v body=%s", response.Code, storage.deleted, fixture.repo.removed, response.Body.String())
	}
}

func TestReleasePresignAlwaysReplacesUnfinishedArtifact(t *testing.T) {
	for _, status := range []metadata.SourceMapArtifactStatus{metadata.ArtifactStatusPending, metadata.ArtifactStatusFailed} {
		storage := &fakeSourceMapStorage{}
		fixture := newReleaseFixture(t, metadata.RoleMember, storage)
		fixture.repo.byName = &metadata.SourceMapArtifact{ID: uuid.New(), Status: status, SHA256: make([]byte, 32), OSSKey: "stale"}
		response := fixture.session(http.MethodPost, fixture.url("/artifacts/presign"), presignBody("map", ""))
		if response.Code != http.StatusCreated || len(fixture.repo.removed) != 1 || len(storage.deleted) != 1 {
			t.Fatalf("%s: status=%d removed=%v body=%s", status, response.Code, fixture.repo.removed, response.Body.String())
		}
	}
}

func TestReleasePresignDistinguishesMissingAndFailingStorage(t *testing.T) {
	missing := newReleaseFixture(t, metadata.RoleMember, nil)
	response := missing.session(http.MethodPost, missing.url("/artifacts/presign"), presignBody("map", ""))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "OBJECT_STORAGE_NOT_CONFIGURED") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	switcher := sourcemap.NewSwitchableStorage(nil, nil)
	unconfigured := newReleaseFixture(t, metadata.RoleMember, switcher)
	response = unconfigured.session(http.MethodPost, unconfigured.url("/artifacts/presign"), presignBody("map", ""))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "OBJECT_STORAGE_NOT_CONFIGURED") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	switcher.SetUnavailable()
	response = unconfigured.session(http.MethodPost, unconfigured.url("/artifacts/presign"), presignBody("map", ""))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "OBJECT_STORAGE_UNAVAILABLE") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestReleaseCompleteRejectsObjectMismatch(t *testing.T) {
	digest := sha256.Sum256([]byte("map"))
	storage := &fakeSourceMapStorage{object: sourcemap.ObjectInfo{SizeBytes: 2, SHA256: hex.EncodeToString(digest[:])}}
	fixture := newReleaseFixture(t, metadata.RoleMember, storage)
	artifactID := uuid.New()
	fixture.repo.artifact = metadata.SourceMapArtifact{ID: artifactID, ReleaseID: fixture.releaseID, OSSKey: "object", SHA256: digest[:], SizeBytes: 3}
	response := fixture.session(http.MethodPost, fixture.url("/artifacts/"+artifactID.String()+"/complete"), "")
	if response.Code != http.StatusUnprocessableEntity || fixture.repo.status != metadata.ArtifactStatusFailed || !strings.Contains(response.Body.String(), "ARTIFACT_MISMATCH") || len(fixture.remaps.queued) != 0 {
		t.Fatalf("status=%d artifact_status=%s body=%s", response.Code, fixture.repo.status, response.Body.String())
	}
}

func TestReleaseCompleteQueuesRemapWhenReady(t *testing.T) {
	digest := sha256.Sum256([]byte("map"))
	storage := &fakeSourceMapStorage{object: sourcemap.ObjectInfo{SizeBytes: 3, SHA256: hex.EncodeToString(digest[:])}}
	fixture := newReleaseFixture(t, metadata.RoleMember, storage)
	artifactID := uuid.New()
	fixture.repo.artifact = metadata.SourceMapArtifact{ID: artifactID, ReleaseID: fixture.releaseID, OSSKey: "object", SHA256: digest[:], SizeBytes: 3}
	response := fixture.session(http.MethodPost, fixture.url("/artifacts/"+artifactID.String()+"/complete"), "")
	if response.Code != http.StatusOK || fixture.repo.status != metadata.ArtifactStatusReady || len(fixture.remaps.queued) != 1 || fixture.remaps.queued[0] != "web@1.0.0|browser" {
		t.Fatalf("status=%d artifact_status=%s queued=%v body=%s", response.Code, fixture.repo.status, fixture.remaps.queued, response.Body.String())
	}
}

func TestReleaseCompleteKeepsArtifactPendingWhenStorageFails(t *testing.T) {
	storage := &fakeSourceMapStorage{headErr: errors.New("dial tcp: i/o timeout")}
	fixture := newReleaseFixture(t, metadata.RoleMember, storage)
	artifactID := uuid.New()
	fixture.repo.artifact = metadata.SourceMapArtifact{ID: artifactID, Status: metadata.ArtifactStatusPending, OSSKey: "object", SHA256: make([]byte, 32), SizeBytes: 3}
	response := fixture.session(http.MethodPost, fixture.url("/artifacts/"+artifactID.String()+"/complete"), "")
	if response.Code != http.StatusServiceUnavailable || fixture.repo.status != "" || !strings.Contains(response.Body.String(), "OBJECT_STORAGE_UNAVAILABLE") {
		t.Fatalf("status=%d artifact_status=%s body=%s", response.Code, fixture.repo.status, response.Body.String())
	}
}

func TestReleaseUploadRejectsViewerBeforeStorage(t *testing.T) {
	storage := &fakeSourceMapStorage{}
	fixture := newReleaseFixture(t, metadata.RoleViewer, storage)
	response := fixture.session(http.MethodPost, fixture.url("/artifacts/presign"), `{}`)
	if response.Code != http.StatusForbidden || storage.presigns != 0 {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestReleaseCreateIsIdempotent(t *testing.T) {
	fixture := newReleaseFixture(t, metadata.RoleMember, &fakeSourceMapStorage{})
	target := "/api/v1/projects/" + fixture.projectID.String() + "/releases"
	first := fixture.session(http.MethodPost, target, `{"version":"web@1.0.0","dist":"browser"}`)
	second := fixture.session(http.MethodPost, target, `{"version":"web@1.0.0","dist":"browser"}`)
	if first.Code != http.StatusCreated || second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"artifactCount":0`) {
		t.Fatalf("first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
}

func TestReleaseListPassesPagingAndSearch(t *testing.T) {
	fixture := newReleaseFixture(t, metadata.RoleMember, &fakeSourceMapStorage{})
	target := "/api/v1/projects/" + fixture.projectID.String() + "/releases"
	response := fixture.session(http.MethodGet, target+"?limit=500&q=+web+&cursor=abc", "")
	if response.Code != http.StatusOK || fixture.repo.listOptions.Limit != 100 || fixture.repo.listOptions.Query != "web" ||
		fixture.repo.listOptions.Cursor != "abc" || !strings.Contains(response.Body.String(), `"nextCursor":null`) {
		t.Fatalf("status=%d options=%+v body=%s", response.Code, fixture.repo.listOptions, response.Body.String())
	}
	if response := fixture.session(http.MethodGet, target, ""); fixture.repo.listOptions.Limit != 20 || response.Code != http.StatusOK {
		t.Fatalf("default options=%+v", fixture.repo.listOptions)
	}
	if response := fixture.session(http.MethodGet, target+"?limit=zero", ""); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid limit status=%d", response.Code)
	}
	fixture.repo.listErr = metadata.ErrInvalidReleaseCursor
	if response := fixture.session(http.MethodGet, target+"?cursor=broken", ""); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid cursor status=%d", response.Code)
	}
}

func TestReleaseDeleteRemovesObjectsBeforeRow(t *testing.T) {
	storage := &fakeSourceMapStorage{}
	fixture := newReleaseFixture(t, metadata.RoleMember, storage)
	fixture.repo.artifacts = []metadata.SourceMapArtifact{{OSSKey: "a"}, {OSSKey: "b"}}
	response := fixture.session(http.MethodDelete, fixture.url(""), "")
	if response.Code != http.StatusNoContent || len(storage.deleted) != 2 || fixture.repo.deletedRelease != fixture.releaseID {
		t.Fatalf("status=%d deleted=%v release=%s body=%s", response.Code, storage.deleted, fixture.repo.deletedRelease, response.Body.String())
	}
}

func TestUploadTokenIsScopedToItsProjectAndCannotDelete(t *testing.T) {
	storage := &fakeSourceMapStorage{}
	fixture := newReleaseFixture(t, metadata.RoleViewer, storage)
	response := fixture.token(http.MethodPost, fixture.url("/artifacts/presign"), presignBody("map", ""), "orut_valid")
	if response.Code != http.StatusCreated || storage.presigns != 1 {
		t.Fatalf("own project status=%d body=%s", response.Code, response.Body.String())
	}
	other := releaseURL(uuid.New(), fixture.releaseID, "/artifacts/presign")
	if response := fixture.token(http.MethodPost, other, presignBody("map", ""), "orut_valid"); response.Code != http.StatusNotFound {
		t.Fatalf("other project status=%d body=%s", response.Code, response.Body.String())
	}
	if response := fixture.token(http.MethodPost, fixture.url("/artifacts/presign"), presignBody("map", ""), "orut_revoked"); response.Code != http.StatusUnauthorized ||
		!strings.Contains(response.Body.String(), "INVALID_UPLOAD_TOKEN") {
		t.Fatalf("invalid token status=%d body=%s", response.Code, response.Body.String())
	}
	for _, target := range []string{fixture.url(""), fixture.url("/artifacts/" + uuid.New().String())} {
		if response := fixture.token(http.MethodDelete, target, "", "orut_valid"); response.Code != http.StatusForbidden {
			t.Fatalf("delete %s status=%d body=%s", target, response.Code, response.Body.String())
		}
	}
	if len(storage.deleted) != 0 || fixture.repo.calls != 0 || fixture.repo.deletedRelease != uuid.Nil {
		t.Fatalf("token deleted objects=%v artifacts=%d release=%s", storage.deleted, fixture.repo.calls, fixture.repo.deletedRelease)
	}
}

func TestReleaseSessionWritesStillRequireCSRF(t *testing.T) {
	fixture := newReleaseFixture(t, metadata.RoleMember, &fakeSourceMapStorage{})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+fixture.projectID.String()+"/releases", strings.NewReader(`{"version":"web@1"}`))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	fixture.router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "CSRF_FAILED") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestSourceMapStatusReportsStorageState(t *testing.T) {
	switcher := sourcemap.NewSwitchableStorage(nil, nil)
	fixture := newReleaseFixture(t, metadata.RoleViewer, switcher)
	target := "/api/v1/projects/" + fixture.projectID.String() + "/sourcemaps/status"
	for _, step := range []struct {
		apply func()
		want  string
	}{
		{func() {}, `"storage":"not_configured"`},
		{func() { switcher.Swap(&fakeSourceMapStorage{}, nil) }, `"storage":"ready"`},
		{switcher.SetUnavailable, `"storage":"unavailable"`},
	} {
		step.apply()
		response := fixture.session(http.MethodGet, target, "")
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), step.want) ||
			!strings.Contains(response.Body.String(), `"maxArtifactBytes":67108864`) || !strings.Contains(response.Body.String(), `"remapWindowDays":7`) {
			t.Fatalf("status=%d body=%s want=%s", response.Code, response.Body.String(), step.want)
		}
	}
}

func releaseURL(projectID, releaseID uuid.UUID, suffix string) string {
	return "/api/v1/projects/" + projectID.String() + "/releases/" + releaseID.String() + suffix
}

func TestReleaseDeleteSucceedsWhenStorageForbidsDeletes(t *testing.T) {
	switcher := sourcemap.NewSwitchableStorage(&fakeSourceMapStorage{deleteErr: forbiddenStorageError{}}, nil)
	fixture := newReleaseFixture(t, metadata.RoleMember, switcher)
	fixture.repo.artifacts = []metadata.SourceMapArtifact{{OSSKey: "a"}}
	response := fixture.session(http.MethodDelete, fixture.url(""), "")
	if response.Code != http.StatusNoContent || fixture.repo.deletedRelease != fixture.releaseID {
		t.Fatalf("status=%d release=%s body=%s", response.Code, fixture.repo.deletedRelease, response.Body.String())
	}
	status := fixture.session(http.MethodGet, "/api/v1/projects/"+fixture.projectID.String()+"/sourcemaps/status", "")
	if !strings.Contains(status.Body.String(), `"deleteAllowed":false`) || !strings.Contains(status.Body.String(), `"storage":"ready"`) {
		t.Fatalf("status body=%s", status.Body.String())
	}
}
