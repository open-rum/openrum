package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/sourcemap"
)

const maxSourceMapBytes = int64(1 << 30)

type releaseArtifacts interface {
	CreateReleaseForActor(context.Context, uuid.UUID, metadata.Release) (metadata.Release, error)
	GetRelease(context.Context, uuid.UUID, uuid.UUID) (metadata.Release, error)
	ListReleases(context.Context, uuid.UUID, int) ([]metadata.Release, error)
	CreateArtifact(context.Context, metadata.SourceMapArtifact) (metadata.SourceMapArtifact, error)
	GetArtifact(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (metadata.SourceMapArtifact, error)
	ListArtifacts(context.Context, uuid.UUID, uuid.UUID) ([]metadata.SourceMapArtifact, error)
	SetArtifactStatus(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, metadata.SourceMapArtifactStatus, *string) (metadata.SourceMapArtifact, error)
	DeleteArtifact(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error
}

func (handler *ReleaseHandler) ListReleases(writer http.ResponseWriter, request *http.Request) {
	_, projectID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	releases, err := handler.repo.ListReleases(request.Context(), projectID, 50)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"releases": releases})
}

type ReleaseHandler struct {
	projects overviewProjects
	repo     releaseArtifacts
	storage  sourcemap.Storage
	logger   zerolog.Logger
}

func NewReleaseHandler(projects overviewProjects, repo releaseArtifacts, storage sourcemap.Storage, logger zerolog.Logger) *ReleaseHandler {
	return &ReleaseHandler{projects: projects, repo: repo, storage: storage, logger: logger}
}

type createReleaseRequest struct {
	Version    string     `json:"version"`
	Dist       string     `json:"dist"`
	CommitSHA  string     `json:"commitSha"`
	DeployedAt *time.Time `json:"deployedAt"`
}

func (handler *ReleaseHandler) Create(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, ok := handler.authorize(writer, request)
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
	release, err := handler.repo.CreateReleaseForActor(request.Context(), principal.UserID, metadata.Release{
		ProjectID: projectID, Version: payload.Version, Dist: payload.Dist, CommitSHA: payload.CommitSHA, DeployedAt: payload.DeployedAt,
	})
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, release)
}

type presignArtifactRequest struct {
	ArtifactName string `json:"artifactName"`
	SHA256       string `json:"sha256"`
	SizeBytes    int64  `json:"sizeBytes"`
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
	if err != nil || len(digest) != sha256.Size || payload.SizeBytes < 1 || payload.SizeBytes > maxSourceMapBytes ||
		len(payload.ArtifactName) < 1 || len(payload.ArtifactName) > 1024 || hasControl(payload.ArtifactName) {
		writeReleaseValidationError(writer, request)
		return
	}
	if handler.storage == nil {
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "OBJECT_STORAGE_UNAVAILABLE", "Source map storage is not configured.")
		return
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
		"headers": grant.Headers, "expiresAt": grant.ExpiresAt,
	})
}

func (handler *ReleaseHandler) Complete(writer http.ResponseWriter, request *http.Request) {
	_, projectID, releaseID, artifactID, ok := handler.artifactPath(writer, request)
	if !ok {
		return
	}
	artifact, err := handler.repo.GetArtifact(request.Context(), projectID, releaseID, artifactID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if handler.storage == nil {
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "OBJECT_STORAGE_UNAVAILABLE", "Source map storage is not configured.")
		return
	}
	info, err := handler.storage.Head(request.Context(), artifact.OSSKey)
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
	writeJSON(writer, http.StatusOK, updated)
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
	principal, projectID, releaseID, artifactID, ok := handler.artifactPath(writer, request)
	if !ok {
		return
	}
	artifact, err := handler.repo.GetArtifact(request.Context(), projectID, releaseID, artifactID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if handler.storage == nil {
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "OBJECT_STORAGE_UNAVAILABLE", "Source map storage is not configured.")
		return
	}
	if err := handler.storage.Delete(request.Context(), artifact.OSSKey); err != nil {
		handler.writeStorageError(writer, request, err)
		return
	}
	if err := handler.repo.DeleteArtifact(request.Context(), principal.UserID, projectID, releaseID, artifactID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *ReleaseHandler) authorize(writer http.ResponseWriter, request *http.Request) (auth.Principal, uuid.UUID, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return auth.Principal{}, uuid.Nil, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return auth.Principal{}, uuid.Nil, false
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return auth.Principal{}, uuid.Nil, false
	}
	if err := auth.Authorize(access.Role, auth.ActionManageReleases); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return auth.Principal{}, uuid.Nil, false
	}
	return principal, projectID, true
}

func (handler *ReleaseHandler) artifactPath(writer http.ResponseWriter, request *http.Request) (auth.Principal, uuid.UUID, uuid.UUID, uuid.UUID, bool) {
	principal, projectID, ok := handler.authorize(writer, request)
	if !ok {
		return auth.Principal{}, uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	releaseID, ok := parsePathUUID(writer, request, "releaseId")
	if !ok {
		return auth.Principal{}, uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	artifactID, ok := parsePathUUID(writer, request, "artifactId")
	return principal, projectID, releaseID, artifactID, ok
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
