package httpx

import (
	"context"
	"net/http"
	"time"

	"github.com/rs/zerolog"
)

type Router struct {
	mux     *http.ServeMux
	handler http.Handler
}

func NewRouter(logger zerolog.Logger) *Router {
	mux := http.NewServeMux()
	router := &Router{mux: mux}
	router.handler = RequestID(requestLogger(logger)(recoverer(logger)(mux)))
	return router
}

func (router *Router) Handle(pattern string, handler http.Handler) {
	router.mux.Handle(pattern, handler)
}

func (router *Router) HandleFunc(pattern string, handler http.HandlerFunc) {
	router.mux.HandleFunc(pattern, handler)
}

func (router *Router) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	router.handler.ServeHTTP(response, request)
}

func recoverer(logger zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			defer recoverPanic(logger, response, request, request.Context(), request.Method, request.URL.Path)
			next.ServeHTTP(response, request)
		})
	}
}

func recoverPanic(logger zerolog.Logger, response http.ResponseWriter, request *http.Request, ctx context.Context, method, path string) {
	if recovered := recover(); recovered != nil {
		logger.Error().
			Interface("panic", recovered).
			Str("request_id", RequestIDFromContext(ctx)).
			Str("method", method).
			Str("path", path).
			Msg("request panic recovered")
		WriteError(response, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
	}
}

func requestLogger(logger zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			startedAt := time.Now()
			recorder := &statusRecorder{ResponseWriter: response, status: http.StatusOK}
			next.ServeHTTP(recorder, request)
			logger.Info().
				Str("request_id", RequestIDFromContext(request.Context())).
				Str("method", request.Method).
				Str("path", request.URL.Path).
				Int("status", recorder.status).
				Int64("duration_ms", time.Since(startedAt).Milliseconds()).
				Msg("request completed")
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (recorder *statusRecorder) WriteHeader(status int) {
	if recorder.wroteHeader {
		return
	}
	recorder.status = status
	recorder.wroteHeader = true
	recorder.ResponseWriter.WriteHeader(status)
}

func (recorder *statusRecorder) Write(body []byte) (int, error) {
	if !recorder.wroteHeader {
		recorder.WriteHeader(http.StatusOK)
	}
	return recorder.ResponseWriter.Write(body)
}
