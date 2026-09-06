package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
)

const adminElevationMaximumAge = 5 * time.Minute

type recentElevationChecker interface {
	RequireRecentElevation(context.Context, auth.Principal, time.Duration) error
}

func requireAdminElevation(
	writer http.ResponseWriter,
	request *http.Request,
	principal auth.Principal,
	checker recentElevationChecker,
	logger zerolog.Logger,
) bool {
	if checker == nil {
		logger.Error().Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("admin elevation checker is unavailable")
		httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
		return false
	}
	if err := checker.RequireRecentElevation(request.Context(), principal, adminElevationMaximumAge); err != nil {
		if errors.Is(err, auth.ErrReauthenticationRequired) || errors.Is(err, auth.ErrUnauthenticated) {
			httpx.WriteError(writer, request, http.StatusUnauthorized, "REAUTHENTICATION_REQUIRED", "Re-authenticate before this dangerous operation.")
			return false
		}
		logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("check admin elevation")
		httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
		return false
	}
	return true
}
