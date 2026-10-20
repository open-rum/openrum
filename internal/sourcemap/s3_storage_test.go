package sourcemap

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestS3StorageProbeRoundTripUsesIsolatedPathAndDeletes(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
	objects := make(map[string][]byte)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !strings.HasPrefix(request.URL.Path, "/openrum-test/openrum-diagnostics/connectivity/") {
			http.Error(writer, "unexpected path", http.StatusBadRequest)
			return
		}
		switch request.Method {
		case http.MethodPut:
			objects[request.URL.Path], _ = io.ReadAll(request.Body)
			writer.Header().Set("ETag", `"probe"`)
		case http.MethodGet:
			contents, ok := objects[request.URL.Path]
			if !ok {
				http.NotFound(writer, request)
				return
			}
			_, _ = writer.Write(contents)
		case http.MethodDelete:
			delete(objects, request.URL.Path)
		default:
			http.Error(writer, "unexpected method", http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()
	storage, err := NewS3Storage(t.Context(), "us-east-1", server.URL, "openrum-test", true)
	if err != nil {
		t.Fatal(err)
	}
	result := storage.Probe(t.Context())
	if !result.Success || len(result.Steps) != 3 || len(objects) != 0 {
		t.Fatalf("result=%+v remaining=%d", result, len(objects))
	}
}

func TestS3StorageRejectsInvalidConfiguration(t *testing.T) {
	if _, err := NewS3Storage(context.Background(), "", "", "bucket", false); !errors.Is(err, ErrInvalidStorage) {
		t.Fatalf("err=%v", err)
	}
}

func TestS3StorageProbeWarnsWhenDeleteIsForbidden(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
	objects := make(map[string][]byte)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodPut:
			objects[request.URL.Path], _ = io.ReadAll(request.Body)
			writer.Header().Set("ETag", `"probe"`)
		case http.MethodGet:
			_, _ = writer.Write(objects[request.URL.Path])
		case http.MethodDelete:
			writer.Header().Set("Content-Type", "application/xml")
			writer.WriteHeader(http.StatusForbidden)
			_, _ = io.WriteString(writer, `<Error><Code>AccessDenied</Code><Message>denied</Message></Error>`)
		}
	}))
	defer server.Close()
	storage, err := NewS3Storage(t.Context(), "us-east-1", server.URL, "openrum-test", true)
	if err != nil {
		t.Fatal(err)
	}
	result := storage.Probe(t.Context())
	if !result.Success || result.ErrorCode != "" || len(result.Warnings) != 1 || result.Warnings[0] != "delete_forbidden" {
		t.Fatalf("result=%+v", result)
	}
	if step := result.Steps[2]; step.Name != "delete" || step.Status != "failed" || step.ErrorCode != "forbidden" {
		t.Fatalf("delete step=%+v", step)
	}
}

func TestS3StoragePutWritesTheObjectWithItsContentType(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
	var path, contentType string
	var body []byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		path, contentType = request.URL.Path, request.Header.Get("Content-Type")
		body, _ = io.ReadAll(request.Body)
		writer.Header().Set("ETag", `"stored"`)
	}))
	defer server.Close()
	storage, err := NewS3Storage(t.Context(), "us-east-1", server.URL, "openrum-test", true)
	if err != nil {
		t.Fatal(err)
	}
	if err := storage.Put(t.Context(), "users/u/avatar/h.png", "image/png", []byte("pixels")); err != nil {
		t.Fatal(err)
	}
	if path != "/openrum-test/users/u/avatar/h.png" || contentType != "image/png" || string(body) != "pixels" {
		t.Fatalf("path=%q type=%q body=%q", path, contentType, body)
	}
}
