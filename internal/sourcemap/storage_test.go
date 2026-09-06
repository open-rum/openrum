package sourcemap

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
)

func TestVerifyObjectChecksSizeAndDigest(t *testing.T) {
	digest := bytes.Repeat([]byte{0xab}, 32)
	valid := ObjectInfo{SizeBytes: 42, SHA256: "abababababababababababababababababababababababababababababababab"}
	if err := VerifyObject(valid, 42, digest); err != nil {
		t.Fatal(err)
	}
	for _, object := range []ObjectInfo{{SizeBytes: 41, SHA256: valid.SHA256}, {SizeBytes: 42, SHA256: "bad"}} {
		if err := VerifyObject(object, 42, digest); err != ErrObjectMismatch {
			t.Fatalf("object=%+v err=%v", object, err)
		}
	}
}

type fakeOSSObjectClient struct {
	putErr    error
	getErr    error
	deleteErr error
	body      []byte
	deleted   bool
}

func (client *fakeOSSObjectClient) PutObject(_ context.Context, request *oss.PutObjectRequest, _ ...func(*oss.Options)) (*oss.PutObjectResult, error) {
	client.body, _ = io.ReadAll(request.Body)
	return &oss.PutObjectResult{}, client.putErr
}

func (client *fakeOSSObjectClient) GetObject(context.Context, *oss.GetObjectRequest, ...func(*oss.Options)) (*oss.GetObjectResult, error) {
	if client.getErr != nil {
		return nil, client.getErr
	}
	return &oss.GetObjectResult{Body: io.NopCloser(bytes.NewReader(client.body))}, nil
}

func (client *fakeOSSObjectClient) DeleteObject(context.Context, *oss.DeleteObjectRequest, ...func(*oss.Options)) (*oss.DeleteObjectResult, error) {
	client.deleted = true
	return &oss.DeleteObjectResult{}, client.deleteErr
}

func TestStorageProbeWritesReadsAndAlwaysDeletesDiagnosticObject(t *testing.T) {
	client := &fakeOSSObjectClient{}
	storage := &OSSStorage{probeClient: client, bucket: "openrum-test"}
	result := storage.Probe(t.Context())
	if !result.Success || !client.deleted || len(result.Steps) != 3 || result.DurationMS < 0 {
		t.Fatalf("result=%+v deleted=%v", result, client.deleted)
	}

	client = &fakeOSSObjectClient{putErr: errors.New("credentials unavailable")}
	storage = &OSSStorage{probeClient: client, bucket: "openrum-test"}
	result = storage.Probe(t.Context())
	if result.Success || result.ErrorCode != "credentials" || !client.deleted || len(result.Steps) != 2 {
		t.Fatalf("result=%+v deleted=%v", result, client.deleted)
	}
}

func TestStorageProbeReportsReadIntegrityAndCleanupFailures(t *testing.T) {
	client := &fakeOSSObjectClient{deleteErr: errors.New("delete denied")}
	storage := &OSSStorage{probeClient: client, bucket: "openrum-test"}
	result := storage.Probe(t.Context())
	if result.Success || result.ErrorCode != "cleanup_failed" || !client.deleted {
		t.Fatalf("result=%+v", result)
	}

	client = &fakeOSSObjectClient{getErr: ErrObjectMismatch}
	storage = &OSSStorage{probeClient: client, bucket: "openrum-test"}
	result = storage.Probe(t.Context())
	if result.Success || result.ErrorCode != "integrity" || !client.deleted {
		t.Fatalf("result=%+v", result)
	}
}

func TestOSSStorageProbeRoundTripUsesIsolatedPathAndDeletes(t *testing.T) {
	t.Setenv("OSS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("OSS_ACCESS_KEY_SECRET", "test-secret")
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
	storage, err := NewOSSStorage("cn-hangzhou", server.URL, "openrum-test")
	if err != nil {
		t.Fatal(err)
	}
	result := storage.Probe(t.Context())
	if !result.Success || len(objects) != 0 {
		t.Fatalf("result=%+v remaining=%d", result, len(objects))
	}
}

func TestClassifyStorageProbeErrorUsesSafeFiniteCodes(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "invalid request", err: &oss.ServiceError{StatusCode: http.StatusBadRequest, Code: "InvalidRequest"}, want: "incompatible_endpoint"},
		{name: "unauthorized", err: &oss.ServiceError{StatusCode: http.StatusUnauthorized}, want: "credentials"},
		{name: "forbidden", err: &oss.ServiceError{StatusCode: http.StatusForbidden}, want: "forbidden"},
		{name: "missing bucket", err: &oss.ServiceError{StatusCode: http.StatusNotFound}, want: "bucket_not_found"},
		{name: "unknown", err: errors.New("dial failed with private details"), want: "network"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := classifyStorageProbeError(t.Context(), test.err); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

func TestOSSStorageRejectsInvalidConfigAndLongTTL(t *testing.T) {
	if _, err := NewOSSStorage("", "", "bucket"); err != ErrInvalidStorage {
		t.Fatalf("err=%v", err)
	}
	storage := &OSSStorage{}
	if _, err := storage.PresignUpload(t.Context(), "key", 1, make([]byte, 32), MaxPresignTTL+time.Second); err != ErrObjectMismatch {
		t.Fatalf("err=%v", err)
	}
}
