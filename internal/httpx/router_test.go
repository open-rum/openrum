package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"openrum/internal/observability"
)

func TestRouterRecoversPanicWithBoundedJSONError(t *testing.T) {
	var logs bytes.Buffer
	router := NewRouter(observability.NewLogger(&logs, "api", "test"))
	router.HandleFunc("GET /panic", func(http.ResponseWriter, *http.Request) {
		panic("database-password-must-not-leak")
	})

	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/panic", nil)
	request.Header.Set(RequestIDHeader, "req_test-123")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", response.Code)
	}
	if response.Body.Len() > 512 {
		t.Fatalf("response body is unbounded: %d bytes", response.Body.Len())
	}
	if strings.Contains(response.Body.String(), "database-password") {
		t.Fatal("response leaked panic value")
	}
	if got := response.Header().Get(RequestIDHeader); got != "req_test-123" {
		t.Fatalf("response request ID = %q", got)
	}

	var envelope ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if envelope.Error.Code != "INTERNAL_ERROR" || envelope.Error.RequestID != "req_test-123" {
		t.Fatalf("error envelope = %+v", envelope.Error)
	}
	for _, field := range []string{`"request_id":"req_test-123"`, `"status":500`, `"service":"api"`} {
		if !strings.Contains(logs.String(), field) {
			t.Errorf("logs do not contain %s: %s", field, logs.String())
		}
	}
}

func TestRouterReplacesUnsafeRequestID(t *testing.T) {
	router := NewRouter(observability.NewLogger(&bytes.Buffer{}, "api", "test"))
	router.HandleFunc("GET /ok", func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte(RequestIDFromContext(request.Context())))
	})

	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/ok", nil)
	request.Header.Set(RequestIDHeader, "unsafe\nheader")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	requestID := response.Header().Get(RequestIDHeader)
	if len(requestID) != 32 || response.Body.String() != requestID {
		t.Fatalf("generated request ID = %q, body = %q", requestID, response.Body.String())
	}
}

func TestWriteErrorTruncatesPublicMessage(t *testing.T) {
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	response := httptest.NewRecorder()
	WriteError(response, request, http.StatusBadRequest, "BAD_REQUEST", strings.Repeat("界", 200))

	var envelope ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if len(envelope.Error.Message) > maxPublicErrorMessageBytes {
		t.Fatalf("message length = %d, want <= %d", len(envelope.Error.Message), maxPublicErrorMessageBytes)
	}
}
