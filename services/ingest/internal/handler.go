package ingestservice

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/event"
	"openrum/internal/geo"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
)

var ErrDurableQueueUnavailable = errors.New("durable ingest queue is unavailable")

type EnvelopeAcceptor interface {
	Accept(context.Context, AcceptedEnvelope) (Acceptance, error)
}

type AcceptedEnvelope struct {
	Access        metadata.ProjectKeyAccess
	Envelope      event.EnvelopeV1
	Raw           []byte
	Origin        string
	ClientIP      string
	ClientCountry string
	UserAgent     string
	ReceivedAt    time.Time
	Rejected      []Rejection
}

type Acceptance struct {
	Accepted int         `json:"accepted"`
	Rejected []Rejection `json:"rejected"`
}

type Rejection struct {
	EventID string `json:"eventId"`
	Code    string `json:"code"`
}

type Handler struct {
	authenticator ingest.Authenticator
	limiter       ingest.RateLimiter
	acceptor      EnvelopeAcceptor
	connection    ingest.ConnectionStatusRecorder
	geo           *geo.Resolver
	logger        zerolog.Logger
	now           func() time.Time
	metrics       *Metrics
}

type HandlerOption func(*Handler)

func WithMetrics(metrics *Metrics) HandlerOption {
	return func(handler *Handler) { handler.metrics = metrics }
}

// WithGeoResolver enables country resolution. Without it every event stores an
// unknown country, which is the safe default for a deployment that has not
// declared which proxy it trusts.
func WithGeoResolver(resolver *geo.Resolver) HandlerOption {
	return func(handler *Handler) { handler.geo = resolver }
}

func WithConnectionStatus(connection ingest.ConnectionStatusRecorder) HandlerOption {
	return func(handler *Handler) { handler.connection = connection }
}

func NewHandler(authenticator ingest.Authenticator, limiter ingest.RateLimiter, acceptor EnvelopeAcceptor, logger zerolog.Logger, options ...HandlerOption) *Handler {
	handler := &Handler{
		authenticator: authenticator,
		limiter:       limiter,
		acceptor:      acceptor,
		logger:        logger,
		now:           time.Now,
	}
	for _, option := range options {
		option(handler)
	}
	return handler
}

func (handler *Handler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodOptions {
		handler.preflight(response, request)
		return
	}
	clientIP := remoteIP(request.RemoteAddr)
	if !handler.limiter.AllowIP(request.Context(), clientIP) {
		handler.writeRateLimit(response, request)
		return
	}
	key := singleHeader(request.Header, "X-OpenRUM-Key")
	if key == "" {
		handler.writeError(response, request, http.StatusUnauthorized, "INVALID_KEY", "The project key is invalid or revoked.")
		return
	}
	access, err := handler.authenticator.Authenticate(request.Context(), key)
	if err != nil {
		if !errors.Is(err, metadata.ErrInvalidProjectKey) {
			handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("project key validation failed")
		}
		handler.writeError(response, request, http.StatusUnauthorized, "INVALID_KEY", "The project key is invalid or revoked.")
		return
	}
	handler.markSDKSeen(request.Context(), access.Project.ID, handler.now().UTC())
	origin, ok := allowedOrigin(request.Header.Get("Origin"), access.Project.AllowedOrigins)
	if !ok {
		handler.markRejected(request.Context(), access.Project.ID, ingest.RejectOriginRejected)
		handler.writeError(response, request, http.StatusForbidden, "ORIGIN_REJECTED", "The request origin is not allowed for this project.")
		return
	}
	setCORSHeaders(response.Header(), origin)
	if !handler.limiter.AllowProject(request.Context(), access.Project.ID) {
		handler.markRejected(request.Context(), access.Project.ID, ingest.RejectRateLimited)
		handler.writeRateLimit(response, request)
		return
	}
	body, err := ingest.ReadEnvelopeBody(request)
	if err != nil {
		handler.markRejected(request.Context(), access.Project.ID, bodyRejectReason(err))
		handler.writeBodyError(response, request, err)
		return
	}
	envelope, rejections, err := validateEnvelope(body)
	if err != nil {
		handler.markRejected(request.Context(), access.Project.ID, ingest.RejectInvalidEnvelope)
		handler.writeError(response, request, http.StatusBadRequest, "INVALID_ENVELOPE", "The event envelope does not match a supported schema.")
		return
	}
	if envelope.Context.Environment != access.Project.Environment {
		handler.markRejected(request.Context(), access.Project.ID, ingest.RejectEnvironmentMismatch)
		handler.writeError(response, request, http.StatusBadRequest, "ENVIRONMENT_MISMATCH", "The envelope environment does not match the project.")
		return
	}
	if len(envelope.Events) == 0 {
		handler.markRejected(request.Context(), access.Project.ID, ingest.RejectInvalidEvent)
		result := Acceptance{Accepted: 0, Rejected: rejections}
		if handler.metrics != nil {
			handler.metrics.observeRejectedOnly(rejections)
		}
		handler.writeAcceptance(response, http.StatusMultiStatus, result)
		return
	}
	acceptStarted := time.Now()
	receivedAt := handler.now().UTC()
	result, err := handler.acceptor.Accept(request.Context(), AcceptedEnvelope{
		Access: access, Envelope: envelope, Raw: body, Origin: origin, ClientIP: clientIP,
		ClientCountry: handler.geo.Country(request.RemoteAddr, request.Header),
		UserAgent:     boundedHeader(request.UserAgent(), 512), ReceivedAt: receivedAt, Rejected: rejections,
	})
	if err != nil {
		handler.markRejected(request.Context(), access.Project.ID, ingest.RejectIngestUnavailable)
		if handler.metrics != nil {
			handler.metrics.observeUnavailable(time.Since(acceptStarted))
		}
		response.Header().Set("Retry-After", "1")
		if !errors.Is(err, ErrDurableQueueUnavailable) {
			handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("durable ingest acceptance failed")
		}
		httpx.WriteError(response, request, http.StatusServiceUnavailable, "INGEST_UNAVAILABLE", "Events could not be durably accepted. Retry later.")
		return
	}
	handler.markEventReceived(request.Context(), access.Project.ID, receivedAt)
	if len(result.Rejected) > 0 {
		handler.markRejected(request.Context(), access.Project.ID, ingest.RejectInvalidEvent)
	}
	if handler.metrics != nil {
		handler.metrics.observeAccepted(AcceptedEnvelope{Envelope: envelope, Raw: body, Rejected: result.Rejected}, time.Since(acceptStarted))
	}
	status := http.StatusAccepted
	if len(result.Rejected) > 0 {
		status = http.StatusMultiStatus
	}
	handler.writeAcceptance(response, status, result)
}

func (handler *Handler) writeAcceptance(response http.ResponseWriter, status int, result Acceptance) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(result)
}

func (handler *Handler) preflight(response http.ResponseWriter, request *http.Request) {
	origin, ok := canonicalOrigin(request.Header.Get("Origin"))
	if !ok {
		handler.writeError(response, request, http.StatusForbidden, "ORIGIN_REJECTED", "A valid HTTP Origin is required.")
		return
	}
	setCORSHeaders(response.Header(), origin)
	response.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	response.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Encoding, X-OpenRUM-Key")
	response.Header().Set("Access-Control-Max-Age", "600")
	response.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) writeBodyError(response http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, ingest.ErrPayloadTooLarge):
		handler.writeError(response, request, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "The event envelope exceeds the allowed size or compression ratio.")
	case errors.Is(err, ingest.ErrUnsupportedEncoding):
		handler.writeError(response, request, http.StatusUnsupportedMediaType, "UNSUPPORTED_ENCODING", "Only identity and gzip content encoding are supported.")
	case errors.Is(err, ingest.ErrUnsupportedMedia):
		handler.writeError(response, request, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.")
	case errors.Is(err, ingest.ErrInvalidCompression):
		handler.writeError(response, request, http.StatusBadRequest, "INVALID_COMPRESSION", "The gzip request body is invalid.")
	default:
		handler.writeError(response, request, http.StatusBadRequest, "INVALID_BODY", "The request body could not be read.")
	}
}

func bodyRejectReason(err error) ingest.RejectReason {
	switch {
	case errors.Is(err, ingest.ErrPayloadTooLarge):
		return ingest.RejectPayloadTooLarge
	case errors.Is(err, ingest.ErrUnsupportedEncoding):
		return ingest.RejectUnsupportedEncoding
	case errors.Is(err, ingest.ErrUnsupportedMedia):
		return ingest.RejectUnsupportedMedia
	case errors.Is(err, ingest.ErrInvalidCompression):
		return ingest.RejectInvalidCompression
	default:
		return ingest.RejectInvalidBody
	}
}

func allowedOrigin(raw string, allowed []string) (string, bool) {
	origin, ok := canonicalOrigin(raw)
	if !ok {
		return "", false
	}
	for _, candidate := range allowed {
		if normalized, valid := canonicalOrigin(candidate); valid && normalized == origin {
			return origin, true
		}
	}
	return "", false
}

func canonicalOrigin(raw string) (string, bool) {
	if raw == "" || strings.ContainsAny(raw, " \t\r\n,") {
		return "", false
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", false
	}
	hostname := strings.ToLower(parsed.Hostname())
	port := parsed.Port()
	if (parsed.Scheme == "http" && port == "80") || (parsed.Scheme == "https" && port == "443") {
		port = ""
	}
	host := hostname
	if strings.Contains(hostname, ":") {
		host = "[" + hostname + "]"
	}
	if port != "" {
		host = net.JoinHostPort(hostname, port)
	}
	return parsed.Scheme + "://" + host, true
}

func singleHeader(header http.Header, name string) string {
	values := header.Values(name)
	if len(values) != 1 || values[0] == "" || strings.ContainsAny(values[0], " \t\r\n,") {
		return ""
	}
	return values[0]
}

func remoteIP(remoteAddress string) string {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err == nil {
		return host
	}
	if len(remoteAddress) > 128 {
		return remoteAddress[:128]
	}
	return remoteAddress
}

func boundedHeader(value string, maximum int) string {
	if len(value) > maximum {
		return value[:maximum]
	}
	return value
}

func setCORSHeaders(header http.Header, origin string) {
	header.Set("Access-Control-Allow-Origin", origin)
	header.Set("Access-Control-Expose-Headers", "X-Request-ID, Retry-After")
	header.Add("Vary", "Origin")
}

func (handler *Handler) writeRateLimit(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Retry-After", "1")
	handler.writeError(response, request, http.StatusTooManyRequests, "RATE_LIMITED", "The ingest rate limit was exceeded. Retry later.")
}

func (handler *Handler) writeError(response http.ResponseWriter, request *http.Request, status int, code, message string) {
	if handler.metrics != nil {
		handler.metrics.observeEnvelopeRejected(code)
	}
	httpx.WriteError(response, request, status, code, message)
}

func (handler *Handler) markSDKSeen(ctx context.Context, projectID uuid.UUID, at time.Time) {
	if handler.connection != nil {
		_ = handler.connection.MarkSDKSeen(context.WithoutCancel(ctx), projectID, at)
	}
}

func (handler *Handler) markEventReceived(ctx context.Context, projectID uuid.UUID, at time.Time) {
	if handler.connection != nil {
		_ = handler.connection.MarkEventReceived(context.WithoutCancel(ctx), projectID, at)
	}
}

func (handler *Handler) markRejected(ctx context.Context, projectID uuid.UUID, reason ingest.RejectReason) {
	if handler.connection != nil {
		_ = handler.connection.MarkRejected(context.WithoutCancel(ctx), projectID, handler.now().UTC(), reason)
	}
}

type UnavailableAcceptor struct{}

func (UnavailableAcceptor) Accept(context.Context, AcceptedEnvelope) (Acceptance, error) {
	return Acceptance{}, ErrDurableQueueUnavailable
}
