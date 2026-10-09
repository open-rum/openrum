package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBrowserSDKHandlerServesVersionedImmutableJavaScript(t *testing.T) {
	handler, err := NewBrowserSDKHandler([]byte(`var OpenRUM={init:function(){}};`))
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, BrowserSDKPublicPath, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "OpenRUM") {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "text/javascript; charset=utf-8" ||
		response.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" ||
		response.Header().Get("Access-Control-Allow-Origin") != "*" ||
		response.Header().Get("Cross-Origin-Resource-Policy") != "cross-origin" ||
		response.Header().Get("ETag") == "" {
		t.Fatalf("headers=%v", response.Header())
	}
}

func TestBrowserSDKHandlerHonorsETag(t *testing.T) {
	handler, err := NewBrowserSDKHandler([]byte(`var OpenRUM={};`))
	if err != nil {
		t.Fatal(err)
	}
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequestWithContext(context.Background(), http.MethodGet, BrowserSDKPublicPath, nil))

	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, BrowserSDKPublicPath, nil)
	request.Header.Set("If-None-Match", first.Header().Get("ETag"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotModified || response.Body.Len() != 0 {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestBrowserSDKHandlerRejectsEmptyBundle(t *testing.T) {
	if _, err := NewBrowserSDKHandler(nil); err == nil {
		t.Fatal("expected an empty bundle error")
	}
}
