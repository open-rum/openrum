package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
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
	release  metadata.Release
	artifact metadata.SourceMapArtifact
	status   metadata.SourceMapArtifactStatus
	calls    int
}

func (repo *fakeReleaseRepo) CreateReleaseForActor(_ context.Context, _ uuid.UUID, release metadata.Release) (metadata.Release, error) {
	release.ID = uuid.New()
	return release, nil
}
func (repo *fakeReleaseRepo) GetRelease(_ context.Context, projectID, releaseID uuid.UUID) (metadata.Release, error) {
	return metadata.Release{ID: releaseID, ProjectID: projectID}, nil
}
func (repo *fakeReleaseRepo) ListReleases(_ context.Context, projectID uuid.UUID, _ int) ([]metadata.Release, error) {
	return []metadata.Release{{ID: uuid.New(), ProjectID: projectID, Version: "web@1.0.0"}}, nil
}
func (repo *fakeReleaseRepo) CreateArtifact(_ context.Context, artifact metadata.SourceMapArtifact) (metadata.SourceMapArtifact, error) {
	repo.artifact = artifact
	return artifact, nil
}
func (repo *fakeReleaseRepo) GetArtifact(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (metadata.SourceMapArtifact, error) {
	return repo.artifact, nil
}
func (repo *fakeReleaseRepo) ListArtifacts(context.Context, uuid.UUID, uuid.UUID) ([]metadata.SourceMapArtifact, error) {
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

type fakeSourceMapStorage struct {
	grant       sourcemap.UploadGrant
	object      sourcemap.ObjectInfo
	presignTTL  time.Duration
	presignSize int64
	deleted     string
}

func (storage *fakeSourceMapStorage) PresignUpload(_ context.Context, _ string, size int64, _ []byte, ttl time.Duration) (sourcemap.UploadGrant, error) {
	storage.presignTTL, storage.presignSize = ttl, size
	return storage.grant, nil
}
func (storage *fakeSourceMapStorage) Head(context.Context, string) (sourcemap.ObjectInfo, error) {
	return storage.object, nil
}
func (storage *fakeSourceMapStorage) Delete(_ context.Context, key string) error {
	storage.deleted = key
	return nil
}
func (storage *fakeSourceMapStorage) Read(context.Context, string, int64) ([]byte, error) {
	return nil, nil
}

func TestReleasePresignReturnsBoundedGrant(t *testing.T) {
	userID, projectID, releaseID := uuid.New(), uuid.New(), uuid.New()
	expires := time.Now().UTC().Add(sourcemap.MaxPresignTTL)
	storage := &fakeSourceMapStorage{grant: sourcemap.UploadGrant{URL: "https://oss.example/upload", Method: http.MethodPut, Headers: map[string]string{"x-oss-meta-sha256": "abc"}, ExpiresAt: expires}}
	repo := &fakeReleaseRepo{}
	handler := NewReleaseHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleMember}}, repo, storage, zerolog.Nop())
	router := releaseTestRouter(handler, userID)
	digest := sha256.Sum256([]byte("map"))
	body := `{"artifactName":"~/assets/app.js.map","sha256":"` + hex.EncodeToString(digest[:]) + `","sizeBytes":321}`
	request := httptest.NewRequest(http.MethodPost, releaseURL(projectID, releaseID, "/artifacts/presign"), strings.NewReader(body))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated || storage.presignTTL != sourcemap.MaxPresignTTL || storage.presignSize != 321 ||
		!strings.Contains(response.Body.String(), "https://oss.example/upload") || !strings.Contains(response.Body.String(), expires.Format("2006-01-02")) {
		t.Fatalf("status=%d ttl=%s size=%d body=%s", response.Code, storage.presignTTL, storage.presignSize, response.Body.String())
	}
}

func TestReleaseCompleteRejectsObjectMismatch(t *testing.T) {
	userID, projectID, releaseID, artifactID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	digest := sha256.Sum256([]byte("map"))
	repo := &fakeReleaseRepo{artifact: metadata.SourceMapArtifact{ID: artifactID, ReleaseID: releaseID, OSSKey: "object", SHA256: digest[:], SizeBytes: 3}}
	storage := &fakeSourceMapStorage{object: sourcemap.ObjectInfo{SizeBytes: 2, SHA256: hex.EncodeToString(digest[:])}}
	handler := NewReleaseHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleMember}}, repo, storage, zerolog.Nop())
	router := releaseTestRouter(handler, userID)
	request := httptest.NewRequest(http.MethodPost, releaseURL(projectID, releaseID, "/artifacts/"+artifactID.String()+"/complete"), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity || repo.status != metadata.ArtifactStatusFailed || !strings.Contains(response.Body.String(), "ARTIFACT_MISMATCH") {
		t.Fatalf("status=%d artifact_status=%s body=%s", response.Code, repo.status, response.Body.String())
	}
}

func TestReleaseUploadRejectsViewerBeforeStorage(t *testing.T) {
	userID, projectID, releaseID := uuid.New(), uuid.New(), uuid.New()
	storage := &fakeSourceMapStorage{}
	handler := NewReleaseHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleViewer}}, &fakeReleaseRepo{}, storage, zerolog.Nop())
	router := releaseTestRouter(handler, userID)
	request := httptest.NewRequest(http.MethodPost, releaseURL(projectID, releaseID, "/artifacts/presign"), strings.NewReader(`{}`))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || storage.presignTTL != 0 {
		t.Fatalf("status=%d ttl=%s body=%s", response.Code, storage.presignTTL, response.Body.String())
	}
}

func releaseTestRouter(handler *ReleaseHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("POST /api/v1/projects/{projectId}/releases/{releaseId}/artifacts/presign", authenticated(http.HandlerFunc(handler.Presign)))
	router.Handle("POST /api/v1/projects/{projectId}/releases/{releaseId}/artifacts/{artifactId}/complete", authenticated(http.HandlerFunc(handler.Complete)))
	return router
}

func releaseURL(projectID, releaseID uuid.UUID, suffix string) string {
	return "/api/v1/projects/" + projectID.String() + "/releases/" + releaseID.String() + suffix
}
