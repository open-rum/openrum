package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/avatar"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/sourcemap"
)

// avatarStore is the part of object storage that profile pictures use. Source map storage
// provides it, so a picture can be uploaded exactly when source maps can.
type avatarStore interface {
	State() sourcemap.StorageState
	Put(ctx context.Context, key, contentType string, body []byte) error
	Read(ctx context.Context, key string, maximum int64) ([]byte, error)
	Delete(ctx context.Context, key string) error
}

// AvatarHandler lets a person pick a generated profile picture or, when object storage is
// configured, upload one, and serves uploaded pictures to people who share an organization
// with them. The bucket stays private: pictures only leave it through this handler.
type AvatarHandler struct {
	avatars *metadata.AvatarRepository
	store   avatarStore
	logger  zerolog.Logger
}

func NewAvatarHandler(avatars *metadata.AvatarRepository, store avatarStore, logger zerolog.Logger) *AvatarHandler {
	return &AvatarHandler{avatars: avatars, store: store, logger: logger}
}

// Status says whether uploading is possible and what the Console should offer.
func (handler *AvatarHandler) Status(writer http.ResponseWriter, request *http.Request) {
	if _, ok := httpx.PrincipalFromContext(request.Context()); !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"uploadAvailable": handler.uploadAvailable(),
		"maxUploadBytes":  avatar.MaxUploadBytes,
		"styles":          avatar.Styles,
	})
}

func (handler *AvatarHandler) uploadAvailable() bool {
	return handler.store != nil && handler.store.State() == sourcemap.StorageReady
}

type setAvatarRequest struct {
	// Avatar is a generated-avatar reference, or null to go back to initials.
	Avatar *string `json:"avatar"`
}

// Set stores a choice. A JSON body picks a generated avatar or clears it; a PNG body is an
// upload. Anything else is refused.
func (handler *AvatarHandler) Set(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	mediaType, _, _ := mime.ParseMediaType(request.Header.Get("Content-Type"))
	switch mediaType {
	case "application/json":
		handler.setGenerated(writer, request, principal.UserID)
	case avatar.ContentType:
		handler.upload(writer, request, principal.UserID)
	default:
		httpx.WriteError(writer, request, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Send JSON to pick an avatar or image/png to upload one.")
	}
}

func (handler *AvatarHandler) setGenerated(writer http.ResponseWriter, request *http.Request, userID uuid.UUID) {
	var payload setAvatarRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	value := ""
	if payload.Avatar != nil {
		value = strings.TrimSpace(*payload.Avatar)
		if err := avatar.ValidateGenerated(value); err != nil {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Avatar is invalid.")
			return
		}
	}
	handler.save(writer, request, userID, value)
}

func (handler *AvatarHandler) upload(writer http.ResponseWriter, request *http.Request, userID uuid.UUID) {
	if !handler.uploadAvailable() {
		httpx.WriteError(writer, request, http.StatusConflict, "OBJECT_STORAGE_NOT_CONFIGURED", "Uploading a picture needs object storage.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, avatar.MaxUploadBytes)
	body, err := io.ReadAll(request.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpx.WriteError(writer, request, http.StatusRequestEntityTooLarge, "AVATAR_TOO_LARGE", "The picture is too large.")
			return
		}
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "The picture could not be read.")
		return
	}
	clean, hash, err := avatar.Normalize(body)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "AVATAR_INVALID", "Use a PNG picture between 32 and 512 pixels on each side.")
		return
	}
	if err := handler.store.Put(request.Context(), avatar.ObjectKey(userID, hash), avatar.ContentType, clean); err != nil {
		handler.logger.Error().Err(err).Msg("store profile picture")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "OBJECT_STORAGE_UNAVAILABLE", "Object storage did not accept the picture.")
		return
	}
	handler.save(writer, request, userID, avatar.UploadValue(hash))
}

// save records the new reference, then removes the uploaded picture it replaced. A delete
// the bucket refuses is only logged: the object is unreachable once nothing refers to it.
func (handler *AvatarHandler) save(writer http.ResponseWriter, request *http.Request, userID uuid.UUID, value string) {
	previous, err := handler.avatars.Set(request.Context(), userID, value)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if old, ok := avatar.ParseUpload(previous); ok && previous != value && handler.store != nil {
		if err := handler.store.Delete(context.WithoutCancel(request.Context()), avatar.ObjectKey(userID, old)); err != nil &&
			!sourcemap.IsObjectNotFound(err) {
			handler.logger.Warn().Err(err).Msg("remove replaced profile picture")
		}
	}
	body, _ := json.Marshal(map[string]any{"avatar": nullable(value)})
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(append(body, '\n'))
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// Get serves an uploaded picture to its owner and to people who share an organization with
// them. The URL carries the picture's hash (?v=) so a changed picture is a new address and
// the old one can be cached for good.
func (handler *AvatarHandler) Get(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	ownerID, ok := parsePathUUID(writer, request, "userId")
	if !ok {
		return
	}
	value, err := handler.avatars.Visible(request.Context(), principal.UserID, ownerID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	hash, uploaded := avatar.ParseUpload(value)
	if !uploaded || handler.store == nil {
		httpx.WriteError(writer, request, http.StatusNotFound, "NOT_FOUND", "Resource not found.")
		return
	}
	body, err := handler.store.Read(request.Context(), avatar.ObjectKey(ownerID, hash), avatar.MaxUploadBytes)
	if err != nil {
		if !sourcemap.IsObjectNotFound(err) {
			handler.logger.Warn().Err(err).Msg("read profile picture")
		}
		// The Console falls back to initials when the image does not load.
		httpx.WriteError(writer, request, http.StatusNotFound, "NOT_FOUND", "Resource not found.")
		return
	}
	header := writer.Header()
	header.Set("Content-Type", avatar.ContentType)
	header.Set("X-Content-Type-Options", "nosniff")
	if request.URL.Query().Get("v") == hash {
		header.Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		header.Set("Cache-Control", "private, no-cache")
	}
	_, _ = writer.Write(body)
}
