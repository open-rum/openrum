package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/sourcemap"
)

type releaseArtifacts interface {
	CreateReleaseForActor(context.Context, uuid.UUID, metadata.Release) (metadata.Release, bool, error)
	GetRelease(context.Context, uuid.UUID, uuid.UUID) (metadata.Release, error)
	ListReleases(context.Context, uuid.UUID, metadata.ReleaseListOptions) (metadata.ReleasePage, error)
	DeleteRelease(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
	CreateArtifact(context.Context, metadata.SourceMapArtifact) (metadata.SourceMapArtifact, error)
	GetArtifact(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (metadata.SourceMapArtifact, error)
	GetArtifactByName(context.Context, uuid.UUID, uuid.UUID, string) (metadata.SourceMapArtifact, error)
	ListArtifacts(context.Context, uuid.UUID, uuid.UUID) ([]metadata.SourceMapArtifact, error)
	SetArtifactStatus(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, metadata.SourceMapArtifactStatus, *string) (metadata.SourceMapArtifact, error)
	DeleteArtifact(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error
	RemoveArtifact(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
}

// remapQueue asks the Worker to map recent events of a release again once a
// late artifact becomes ready.
type remapQueue interface {
	Queue(context.Context, uuid.UUID, string, string) error
}

type storageStateReporter interface {
	State() sourcemap.StorageState
}

const (
	defaultReleasePageSize = 20
	maxReleasePageSize     = 100
	// RemapWindowDays is how far back a late upload re-maps error events.
	RemapWindowDays = 7
)

type ReleaseHandler struct {
	projects overviewProjects
	repo     releaseArtifacts
	storage  sourcemap.Storage
	remaps   remapQueue
	logger   zerolog.Logger
}

func NewReleaseHandler(projects overviewProjects, repo releaseArtifacts, storage sourcemap.Storage, remaps remapQueue, logger zerolog.Logger) *ReleaseHandler {
	return &ReleaseHandler{projects: projects, repo: repo, storage: storage, remaps: remaps, logger: logger}
}

// releaseCaller is who performs a release request: a Console user, or an
// upload token attributed to the user who created it (uuid.Nil once deleted).
type releaseCaller struct {
	userID uuid.UUID
	token  bool
}

func (handler *ReleaseHandler) ListReleases(writer http.ResponseWriter, request *http.Request) {
	_, projectID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	query := request.URL.Query()
	options := metadata.ReleaseListOptions{Limit: defaultReleasePageSize, Cursor: query.Get("cursor"), Query: strings.TrimSpace(query.Get("q"))}
	if raw := query.Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 {
			writeReleaseValidationError(writer, request)
			return
		}
		options.Limit = min(limit, maxReleasePageSize)
	}
	if len(options.Query) > 128 || hasControl(options.Query) || len(options.Cursor) > 256 {
		writeReleaseValidationError(writer, request)
		return
	}
	page, err := handler.repo.ListReleases(request.Context(), projectID, options)
	if errors.Is(err, metadata.ErrInvalidReleaseCursor) {
		writeReleaseValidationError(writer, request)
		return
	}
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, page)
}

type createReleaseRequest struct {
	Version    string     `json:"version"`
	Dist       string     `json:"dist"`
	CommitSHA  string     `json:"commitSha"`
	DeployedAt *time.Time `json:"deployedAt"`
}

// Create is idempotent per (version, dist): 201 for a new release, 200 with the
// existing one, so a rebuilt or retried pipeline can run the same upload step.
func (handler *ReleaseHandler) Create(writer http.ResponseWriter, request *http.Request) {
	caller, projectID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	var payload createReleaseRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Version, payload.Dist, payload.CommitSHA = strings.TrimSpace(payload.Version), strings.TrimSpace(payload.Dist), strings.TrimSpace(payload.CommitSHA)
	if len(payload.Version) < 1 || len(payload.Version) > 128 || len(payload.Dist) > 64 || len(payload.CommitSHA) > 64 || hasControl(payload.Version+payload.Dist+payload.CommitSHA) {
		writeReleaseValidationError(writer, request)
		return
	}
	release, created, err := handler.repo.CreateReleaseForActor(request.Context(), caller.userID, metadata.Release{
		ProjectID: projectID, Version: payload.Version, Dist: payload.Dist, CommitSHA: payload.CommitSHA, DeployedAt: payload.DeployedAt,
	})
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(writer, status, release)
}

// DeleteRelease removes every artifact object before the catalog rows, so a
// failure leaves the release visible and retryable instead of orphaning objects.
func (handler *ReleaseHandler) DeleteRelease(writer http.ResponseWriter, request *http.Request) {
	caller, projectID, ok := handler.authorizeSession(writer, request)
	if !ok {
		return
	}
	releaseID, ok := parsePathUUID(writer, request, "releaseId")
	if !ok {
		return
	}
	if _, err := handler.repo.GetRelease(request.Context(), projectID, releaseID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	artifacts, err := handler.repo.ListArtifacts(request.Context(), projectID, releaseID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if len(artifacts) > 0 && !handler.requireStorage(writer, request) {
		return
	}
	for _, artifact := range artifacts {
		if err := handler.deleteObject(request.Context(), artifact.OSSKey); err != nil {
			handler.writeStorageError(writer, request, err)
			return
		}
	}
	if err := handler.repo.DeleteRelease(request.Context(), caller.userID, projectID, releaseID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// SourceMapStatus tells any project member whether uploads can work, so the
// Console can explain a missing configuration before an upload fails.
func (handler *ReleaseHandler) SourceMapStatus(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := auth.Authorize(access.Role, auth.ActionReadProject); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"storage": handler.storageState(), "maxArtifactBytes": sourcemap.MaxMapBytes, "remapWindowDays": RemapWindowDays,
		"deleteAllowed": handler.deleteAllowed(),
	})
}

type presignArtifactRequest struct {
	ArtifactName string `json:"artifactName"`
	SHA256       string `json:"sha256"`
	SizeBytes    int64  `json:"sizeBytes"`
	Replace      bool   `json:"replace"`
}

func (handler *ReleaseHandler) Presign(writer http.ResponseWriter, request *http.Request) {
	_, projectID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	releaseID, ok := parsePathUUID(writer, request, "releaseId")
	if !ok {
		return
	}
	if _, err := handler.repo.GetRelease(request.Context(), projectID, releaseID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	var payload presignArtifactRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.ArtifactName = strings.TrimSpace(payload.ArtifactName)
	digest, err := hex.DecodeString(strings.TrimSpace(payload.SHA256))
	if err != nil || len(digest) != sha256.Size || payload.SizeBytes < 1 ||
		len(payload.ArtifactName) < 1 || len(payload.ArtifactName) > 1024 || hasControl(payload.ArtifactName) {
		writeReleaseValidationError(writer, request)
		return
	}
	if payload.SizeBytes > sourcemap.MaxMapBytes {
		httpx.WriteError(writer, request, http.StatusBadRequest, "ARTIFACT_TOO_LARGE",
			fmt.Sprintf("Source map artifacts are limited to %d MiB.", sourcemap.MaxMapBytes>>20))
		return
	}
	existing, err := handler.repo.GetArtifactByName(request.Context(), projectID, releaseID, payload.ArtifactName)
	switch {
	case errors.Is(err, metadata.ErrNotFound):
	case err != nil:
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	case existing.Status == metadata.ArtifactStatusReady && bytes.Equal(existing.SHA256, digest):
		// A rebuilt release uploads identical maps again; nothing to transfer.
		writeJSON(writer, http.StatusOK, map[string]any{"artifact": existing, "skipped": true})
		return
	case existing.Status == metadata.ArtifactStatusReady && !payload.Replace:
		httpx.WriteError(writer, request, http.StatusConflict, "ARTIFACT_EXISTS",
			"A ready artifact with this name has different contents. Upload with replace to overwrite it.")
		return
	}
	if !handler.requireStorage(writer, request) {
		return
	}
	if err == nil {
		// Pending and failed uploads are always superseded; a ready one only
		// when the caller asked to replace it.
		if err := handler.deleteObject(request.Context(), existing.OSSKey); err != nil {
			handler.writeStorageError(writer, request, err)
			return
		}
		if err := handler.repo.RemoveArtifact(request.Context(), projectID, releaseID, existing.ID); err != nil && !errors.Is(err, metadata.ErrNotFound) {
			writeControlPlaneError(writer, request, handler.logger, err)
			return
		}
	}
	artifactID := uuid.New()
	objectKey := fmt.Sprintf("projects/%s/releases/%s/artifacts/%s/%s", projectID, releaseID, artifactID, safeObjectName(payload.ArtifactName))
	grant, err := handler.storage.PresignUpload(request.Context(), objectKey, payload.SizeBytes, digest, sourcemap.MaxPresignTTL)
	if err != nil {
		handler.writeStorageError(writer, request, err)
		return
	}
	artifact, err := handler.repo.CreateArtifact(request.Context(), metadata.SourceMapArtifact{
		ID: artifactID, ReleaseID: releaseID, ArtifactName: payload.ArtifactName, OSSKey: objectKey,
		SHA256: digest, SizeBytes: payload.SizeBytes, Status: metadata.ArtifactStatusPending,
	})
	if err != nil {
		_ = handler.storage.Delete(request.Context(), objectKey)
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{
		"artifact": artifact, "uploadUrl": grant.URL, "method": grant.Method,
		"headers": grant.Headers, "expiresAt": grant.ExpiresAt, "skipped": false,
	})
}

func (handler *ReleaseHandler) Complete(writer http.ResponseWriter, request *http.Request) {
	_, projectID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	releaseID, artifactID, ok := parseArtifactPath(writer, request)
	if !ok {
		return
	}
	artifact, err := handler.repo.GetArtifact(request.Context(), projectID, releaseID, artifactID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if !handler.requireStorage(writer, request) {
		return
	}
	info, err := handler.storage.Head(request.Context(), artifact.OSSKey)
	if err != nil && sourcemap.IsAvailabilityError(err) {
		// Keep the artifact pending: the upload may be fine and completing
		// again after storage recovers should still succeed.
		handler.writeStorageError(writer, request, err)
		return
	}
	if err == nil {
		err = sourcemap.VerifyObject(info, artifact.SizeBytes, artifact.SHA256)
	}
	status := metadata.ArtifactStatusReady
	var message *string
	if err != nil {
		status = metadata.ArtifactStatusFailed
		value := "uploaded object failed size or checksum verification"
		message = &value
	}
	updated, updateErr := handler.repo.SetArtifactStatus(request.Context(), projectID, releaseID, artifactID, status, message)
	if updateErr != nil {
		writeControlPlaneError(writer, request, handler.logger, updateErr)
		return
	}
	if err != nil {
		httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "ARTIFACT_MISMATCH", *message)
		return
	}
	handler.queueRemap(request, projectID, releaseID)
	writeJSON(writer, http.StatusOK, updated)
}

// queueRemap is best effort: the artifact is ready either way and new events
// map immediately; only already-failed recent events depend on the remap.
func (handler *ReleaseHandler) queueRemap(request *http.Request, projectID, releaseID uuid.UUID) {
	if handler.remaps == nil {
		return
	}
	release, err := handler.repo.GetRelease(request.Context(), projectID, releaseID)
	if err == nil {
		err = handler.remaps.Queue(request.Context(), projectID, release.Version, release.Dist)
	}
	if err != nil {
		handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("queue source map remap failed")
	}
}

func (handler *ReleaseHandler) List(writer http.ResponseWriter, request *http.Request) {
	_, projectID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	releaseID, ok := parsePathUUID(writer, request, "releaseId")
	if !ok {
		return
	}
	artifacts, err := handler.repo.ListArtifacts(request.Context(), projectID, releaseID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"artifacts": artifacts})
}

func (handler *ReleaseHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	caller, projectID, ok := handler.authorizeSession(writer, request)
	if !ok {
		return
	}
	releaseID, artifactID, ok := parseArtifactPath(writer, request)
	if !ok {
		return
	}
	artifact, err := handler.repo.GetArtifact(request.Context(), projectID, releaseID, artifactID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if !handler.requireStorage(writer, request) {
		return
	}
	if err := handler.deleteObject(request.Context(), artifact.OSSKey); err != nil {
		handler.writeStorageError(writer, request, err)
		return
	}
	if err := handler.repo.DeleteArtifact(request.Context(), caller.userID, projectID, releaseID, artifactID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// authorize admits a Console user allowed to manage releases, or an upload
// token of this very project. A token for another project is answered as not
// found so tokens cannot probe which project IDs exist.
func (handler *ReleaseHandler) authorize(writer http.ResponseWriter, request *http.Request) (releaseCaller, uuid.UUID, bool) {
	if token, ok := httpx.UploadTokenFromContext(request.Context()); ok {
		projectID, ok := parsePathUUID(writer, request, "projectId")
		if !ok {
			return releaseCaller{}, uuid.Nil, false
		}
		if token.ProjectID != projectID {
			writeControlPlaneError(writer, request, handler.logger, metadata.ErrNotFound)
			return releaseCaller{}, uuid.Nil, false
		}
		caller := releaseCaller{token: true}
		if token.CreatedBy != nil {
			caller.userID = *token.CreatedBy
		}
		return caller, projectID, true
	}
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return releaseCaller{}, uuid.Nil, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return releaseCaller{}, uuid.Nil, false
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return releaseCaller{}, uuid.Nil, false
	}
	if err := auth.Authorize(access.Role, auth.ActionManageReleases); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return releaseCaller{}, uuid.Nil, false
	}
	return releaseCaller{userID: principal.UserID}, projectID, true
}

// authorizeSession guards destructive endpoints, which upload tokens may never
// reach: a leaked CI token must not be able to erase a project's artifacts.
func (handler *ReleaseHandler) authorizeSession(writer http.ResponseWriter, request *http.Request) (releaseCaller, uuid.UUID, bool) {
	if _, ok := httpx.UploadTokenFromContext(request.Context()); ok {
		writeControlPlaneError(writer, request, handler.logger, metadata.ErrForbidden)
		return releaseCaller{}, uuid.Nil, false
	}
	return handler.authorize(writer, request)
}

func parseArtifactPath(writer http.ResponseWriter, request *http.Request) (uuid.UUID, uuid.UUID, bool) {
	releaseID, ok := parsePathUUID(writer, request, "releaseId")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	artifactID, ok := parsePathUUID(writer, request, "artifactId")
	return releaseID, artifactID, ok
}

func (handler *ReleaseHandler) storageState() sourcemap.StorageState {
	if handler.storage == nil {
		return sourcemap.StorageNotConfigured
	}
	if reporter, ok := handler.storage.(storageStateReporter); ok {
		return reporter.State()
	}
	return sourcemap.StorageReady
}

// requireStorage rejects requests that need object storage when none is
// configured at all. A configured but failing backend is still attempted, so
// recovery is noticed by the next request rather than a background probe.
func (handler *ReleaseHandler) requireStorage(writer http.ResponseWriter, request *http.Request) bool {
	if handler.storageState() == sourcemap.StorageNotConfigured {
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "OBJECT_STORAGE_NOT_CONFIGURED",
			"Source map storage is not configured. An Instance Administrator must configure object storage.")
		return false
	}
	return true
}

// deleteObject treats an already absent object as deleted, which is the
// normal case for a pending artifact whose upload never happened. A credential
// without delete permission (403) does not block the deletion either: the row
// goes and the object stays in the bucket, which the Console warns about.
func (handler *ReleaseHandler) deleteObject(ctx context.Context, key string) error {
	err := handler.storage.Delete(ctx, key)
	switch {
	case err == nil || sourcemap.IsObjectNotFound(err):
		return nil
	case sourcemap.IsForbidden(err):
		handler.logger.Warn().Str("object_key", key).Msg("object storage refused delete; object retained in bucket")
		return nil
	}
	return err
}

func (handler *ReleaseHandler) deleteAllowed() bool {
	if capability, ok := handler.storage.(interface{ DeleteAllowed() bool }); ok {
		return capability.DeleteAllowed()
	}
	return true
}

func (handler *ReleaseHandler) writeStorageError(writer http.ResponseWriter, request *http.Request, err error) {
	handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("source map object storage failed")
	httpx.WriteError(writer, request, http.StatusServiceUnavailable, "OBJECT_STORAGE_UNAVAILABLE", "Source map storage is temporarily unavailable.")
}

func writeReleaseValidationError(writer http.ResponseWriter, request *http.Request) {
	httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Release or source map metadata is invalid.")
}

func hasControl(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}

func safeObjectName(value string) string {
	name := path.Base(strings.ReplaceAll(value, "\\", "/"))
	if name == "." || name == "/" || name == "" {
		return "artifact.map"
	}
	return name
}
