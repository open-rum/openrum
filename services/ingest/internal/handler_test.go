package ingestservice

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type fakeAuthenticator struct {
	access metadata.ProjectKeyAccess
	err    error
	calls  int
}

func (authenticator *fakeAuthenticator) Authenticate(context.Context, string) (metadata.ProjectKeyAccess, error) {
	authenticator.calls++
	return authenticator.access, authenticator.err
}

type fakeLimiter struct {
	allowIP      bool
	allowProject bool
}

func (limiter fakeLimiter) AllowIP(context.Context, string) bool { return limiter.allowIP }
func (limiter fakeLimiter) AllowProject(context.Context, uuid.UUID) bool {
	return limiter.allowProject
}

type fakeAcceptor struct {
	accepted *AcceptedEnvelope
	err      error
}

func (acceptor *fakeAcceptor) Accept(_ context.Context, envelope AcceptedEnvelope) (Acceptance, error) {
	acceptor.accepted = &envelope
	if acceptor.err != nil {
		return Acceptance{}, acceptor.err
	}
	return Acceptance{Accepted: len(envelope.Envelope.Events), Rejected: envelope.Rejected}, nil
}

func TestHandlerAcceptsValidatedIdentityAndGzipEnvelopes(t *testing.T) {
	for _, compressed := range []bool{false, true} {
		t.Run(map[bool]string{false: "identity", true: "gzip"}[compressed], func(t *testing.T) {
			authenticator, acceptor, router := testHandler(t, nil)
			body := validEnvelope(t)
			request := ingestRequest(body)
			if compressed {
				request = ingestRequest(gzipData(t, body))
				request.Header.Set("Content-Encoding", "gzip")
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusAccepted {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
			if authenticator.calls != 1 || acceptor.accepted == nil || len(acceptor.accepted.Envelope.Events) != 5 {
				t.Fatalf("auth calls=%d accepted=%+v", authenticator.calls, acceptor.accepted)
			}
			if response.Header().Get("Access-Control-Allow-Origin") != "https://shop.example.com" {
				t.Fatalf("CORS origin = %q", response.Header().Get("Access-Control-Allow-Origin"))
			}
		})
	}
}

func TestHandlerRejectsAuthOriginRateAndSchemaFailures(t *testing.T) {
	tests := []struct {
		name       string
		configure  func(*fakeAuthenticator, *fakeLimiter, *http.Request)
		body       []byte
		wantStatus int
		wantCode   string
	}{
		{name: "missing key", configure: func(_ *fakeAuthenticator, _ *fakeLimiter, request *http.Request) { request.Header.Del("X-OpenRUM-Key") }, wantStatus: 401, wantCode: "INVALID_KEY"},
		{name: "invalid key", configure: func(auth *fakeAuthenticator, _ *fakeLimiter, _ *http.Request) {
			auth.err = metadata.ErrInvalidProjectKey
		}, wantStatus: 401, wantCode: "INVALID_KEY"},
		{name: "origin", configure: func(_ *fakeAuthenticator, _ *fakeLimiter, request *http.Request) {
			request.Header.Set("Origin", "https://evil.example")
		}, wantStatus: 403, wantCode: "ORIGIN_REJECTED"},
		{name: "ip rate", configure: func(_ *fakeAuthenticator, limiter *fakeLimiter, _ *http.Request) { limiter.allowIP = false }, wantStatus: 429, wantCode: "RATE_LIMITED"},
		{name: "project rate", configure: func(_ *fakeAuthenticator, limiter *fakeLimiter, _ *http.Request) { limiter.allowProject = false }, wantStatus: 429, wantCode: "RATE_LIMITED"},
		{name: "schema", body: []byte(`{"schema_version":"invalid"}`), wantStatus: 400, wantCode: "INVALID_ENVELOPE"},
		{name: "environment", body: bytes.ReplaceAll(validEnvelope(t), []byte(`"environment": "production"`), []byte(`"environment": "staging"`)), wantStatus: 400, wantCode: "ENVIRONMENT_MISMATCH"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			authenticator, _, _ := testHandler(t, nil)
			limiter := &fakeLimiter{allowIP: true, allowProject: true}
			acceptor := &fakeAcceptor{}
			handler := NewHandler(authenticator, limiter, acceptor, zerolog.Nop())
			router := testRouter(handler)
			body := test.body
			if body == nil {
				body = validEnvelope(t)
			}
			request := ingestRequest(body)
			if test.configure != nil {
				test.configure(authenticator, limiter, request)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertError(t, response, test.wantStatus, test.wantCode)
			if test.wantStatus == http.StatusTooManyRequests && response.Header().Get("Retry-After") != "1" {
				t.Fatalf("Retry-After = %q", response.Header().Get("Retry-After"))
			}
		})
	}
}

func TestHandlerBoundsBodiesAndCompression(t *testing.T) {
	tests := []struct {
		name       string
		body       []byte
		encoding   string
		mediaType  string
		wantStatus int
		wantCode   string
	}{
		{name: "raw too large", body: bytes.Repeat([]byte("x"), 1024*1024+1), wantStatus: 413, wantCode: "PAYLOAD_TOO_LARGE"},
		{name: "compressed too large", body: bytes.Repeat([]byte("x"), 256*1024+1), encoding: "gzip", wantStatus: 413, wantCode: "PAYLOAD_TOO_LARGE"},
		{name: "decompression bomb", body: gzipData(t, bytes.Repeat([]byte("x"), 1024*1024+1)), encoding: "gzip", wantStatus: 413, wantCode: "PAYLOAD_TOO_LARGE"},
		{name: "ratio bomb", body: gzipData(t, bytes.Repeat([]byte("x"), 512*1024)), encoding: "gzip", wantStatus: 413, wantCode: "PAYLOAD_TOO_LARGE"},
		{name: "bad gzip", body: []byte("not gzip"), encoding: "gzip", wantStatus: 400, wantCode: "INVALID_COMPRESSION"},
		{name: "unsupported encoding", body: validEnvelope(t), encoding: "br", wantStatus: 415, wantCode: "UNSUPPORTED_ENCODING"},
		{name: "unsupported media", body: validEnvelope(t), mediaType: "text/plain", wantStatus: 415, wantCode: "UNSUPPORTED_MEDIA_TYPE"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, _, router := testHandler(t, nil)
			request := ingestRequest(test.body)
			if test.encoding != "" {
				request.Header.Set("Content-Encoding", test.encoding)
			}
			if test.mediaType != "" {
				request.Header.Set("Content-Type", test.mediaType)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertError(t, response, test.wantStatus, test.wantCode)
		})
	}
}

func TestHandlerPreflightAndQueueFailure(t *testing.T) {
	authenticator, acceptor, router := testHandler(t, ErrDurableQueueUnavailable)
	preflight := httptest.NewRequestWithContext(context.Background(), http.MethodOptions, "/ingest/v1/envelope", nil)
	preflight.Header.Set("Origin", "https://unconfigured.example")
	preflightResponse := httptest.NewRecorder()
	router.ServeHTTP(preflightResponse, preflight)
	if preflightResponse.Code != http.StatusNoContent || authenticator.calls != 0 {
		t.Fatalf("preflight status=%d auth calls=%d", preflightResponse.Code, authenticator.calls)
	}

	response := httptest.NewRecorder()
	router.ServeHTTP(response, ingestRequest(validEnvelope(t)))
	assertError(t, response, http.StatusServiceUnavailable, "INGEST_UNAVAILABLE")
	if response.Header().Get("Retry-After") != "1" || acceptor.accepted == nil {
		t.Fatalf("Retry-After=%q accepted=%+v", response.Header().Get("Retry-After"), acceptor.accepted)
	}
	acceptor.err = nil
	retryResponse := httptest.NewRecorder()
	router.ServeHTTP(retryResponse, ingestRequest(validEnvelope(t)))
	if retryResponse.Code != http.StatusAccepted {
		t.Fatalf("retry status=%d body=%s", retryResponse.Code, retryResponse.Body.String())
	}
}

func TestHandlerReturnsPartialAndSkipsKafkaWhenEveryEventIsInvalid(t *testing.T) {
	_, acceptor, router := testHandler(t, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, ingestRequest(envelopeWithInvalidEvents(t, 1)))
	if response.Code != http.StatusMultiStatus || acceptor.accepted == nil || len(acceptor.accepted.Envelope.Events) != 4 {
		t.Fatalf("partial status=%d accepted=%+v body=%s", response.Code, acceptor.accepted, response.Body.String())
	}
	var partial Acceptance
	if err := json.Unmarshal(response.Body.Bytes(), &partial); err != nil {
		t.Fatal(err)
	}
	if partial.Accepted != 4 || len(partial.Rejected) != 1 {
		t.Fatalf("partial=%+v", partial)
	}

	_, acceptor, router = testHandler(t, nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, ingestRequest(envelopeWithInvalidEvents(t, 5)))
	if response.Code != http.StatusMultiStatus || acceptor.accepted != nil {
		t.Fatalf("all-invalid status=%d accepted=%+v body=%s", response.Code, acceptor.accepted, response.Body.String())
	}
	var allInvalid Acceptance
	if err := json.Unmarshal(response.Body.Bytes(), &allInvalid); err != nil {
		t.Fatal(err)
	}
	if allInvalid.Accepted != 0 || len(allInvalid.Rejected) != 5 {
		t.Fatalf("all-invalid=%+v", allInvalid)
	}
}

func FuzzHandlerEnvelope(f *testing.F) {
	fixture := validEnvelopeForFuzz(f)
	f.Add(fixture, false)
	f.Add([]byte(`{"events":[]}`), false)
	f.Add([]byte("not gzip"), true)
	f.Fuzz(func(t *testing.T, body []byte, compressed bool) {
		if len(body) > 2*1024*1024 {
			t.Skip()
		}
		_, _, router := testHandler(t, nil)
		if compressed {
			body = gzipData(t, body)
		}
		request := ingestRequest(body)
		if compressed {
			request.Header.Set("Content-Encoding", "gzip")
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code >= 500 {
			t.Fatalf("unexpected status %d for %d bytes", response.Code, len(body))
		}
	})
}

func testHandler(t testing.TB, acceptErr error) (*fakeAuthenticator, *fakeAcceptor, http.Handler) {
	t.Helper()
	authenticator := &fakeAuthenticator{access: metadata.ProjectKeyAccess{
		Project: metadata.Project{
			ID:             uuid.MustParse("00000000-0000-4000-8000-000000000001"),
			Environment:    "production",
			AllowedOrigins: []string{"https://shop.example.com", "http://localhost:5173"},
			Status:         metadata.ProjectStatusActive,
		},
	}}
	acceptor := &fakeAcceptor{err: acceptErr}
	handler := NewHandler(authenticator, fakeLimiter{allowIP: true, allowProject: true}, acceptor, zerolog.Nop())
	return authenticator, acceptor, testRouter(handler)
}

func testRouter(handler *Handler) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	router.Handle("POST /ingest/v1/envelope", handler)
	router.Handle("OPTIONS /ingest/v1/envelope", handler)
	return router
}

func ingestRequest(body []byte) *http.Request {
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/ingest/v1/envelope", bytes.NewReader(body))
	request.RemoteAddr = "203.0.113.10:4321"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://shop.example.com")
	request.Header.Set("X-OpenRUM-Key", "orr_pk_valid")
	return request
}

func validEnvelope(t testing.TB) []byte {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve fixture path")
	}
	contents, err := os.ReadFile(filepath.Join(filepath.Dir(filename), "..", "..", "..", "packages", "protocol", "fixtures", "valid-all-events.json"))
	if err != nil {
		t.Fatal(err)
	}
	return contents
}

func validEnvelopeForFuzz(f *testing.F) []byte {
	f.Helper()
	return validEnvelope(f)
}

func gzipData(t testing.TB, body []byte) []byte {
	t.Helper()
	var output bytes.Buffer
	writer := gzip.NewWriter(&output)
	if _, err := writer.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func assertError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status=%d want=%d body=%s", response.Code, status, response.Body.String())
	}
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != code {
		t.Fatalf("code=%q want=%q body=%s", payload.Error.Code, code, response.Body.String())
	}
}
