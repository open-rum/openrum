package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/httpx"
	"openrum/internal/query"
)

// searchValueCacheTTL lets a burst of keystrokes share one scan.
const searchValueCacheTTL = time.Minute

type searchValueQueries interface {
	Values(context.Context, query.SearchValueFilters) ([]query.SearchValue, error)
}

// SearchValueHandler suggests values for the shared search while someone types.
type SearchValueHandler struct {
	projects overviewProjects
	queries  searchValueQueries
	redis    redis.UniversalClient
	logger   zerolog.Logger
}

func NewSearchValueHandler(projects overviewProjects, queries searchValueQueries, redisClient redis.UniversalClient, logger zerolog.Logger) *SearchValueHandler {
	return &SearchValueHandler{projects: projects, queries: queries, redis: redisClient, logger: logger}
}

func (handler *SearchValueHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	if _, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	values := request.URL.Query()
	from, fromErr := time.Parse(time.RFC3339Nano, values.Get("from"))
	to, toErr := time.Parse(time.RFC3339Nano, values.Get("to"))
	filters, err := query.NormalizeSearchValueFilters(query.SearchValueFilters{
		ProjectID: projectID, From: from, To: to, Environment: values.Get("environment"),
		Dataset: values.Get("dataset"), Field: values.Get("field"), Contains: values.Get("contains"), Event: values.Get("event"),
	})
	if fromErr != nil || toErr != nil || err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A dataset, one of its text fields and a UTC range are required.")
		return
	}
	// Relative ranges move every minute; the key rounds them so the cache still helps.
	key := searchValueCacheKey(projectID, filters)
	if cached, cacheErr := handler.redis.Get(request.Context(), key).Bytes(); cacheErr == nil {
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = writer.Write(cached)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 4*time.Second)
	defer cancel()
	result, err := handler.queries.Values(ctx, filters)
	if err != nil {
		if errors.Is(err, query.ErrInvalidSearchValues) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "This field has no suggestions.")
			return
		}
		handler.logger.Warn().Err(err).Str("project_id", projectID.String()).Msg("search value query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Suggestions are temporarily unavailable.")
		return
	}
	body, err := json.Marshal(map[string]any{"values": result})
	if err != nil {
		httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
		return
	}
	_ = handler.redis.Set(request.Context(), key, body, searchValueCacheTTL).Err()
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = writer.Write(body)
}

func searchValueCacheKey(projectID uuid.UUID, filters query.SearchValueFilters) string {
	parts := []string{
		projectID.String(), filters.Dataset, filters.Field, strings.ToLower(filters.Contains), filters.Event, filters.Environment,
		filters.From.Truncate(time.Minute).Format(time.RFC3339), filters.To.Truncate(time.Minute).Format(time.RFC3339),
	}
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return "openrum:search-values:" + hex.EncodeToString(digest[:])
}
