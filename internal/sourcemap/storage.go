package sourcemap

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
)

const MaxPresignTTL = 15 * time.Minute

var (
	ErrObjectMismatch = errors.New("uploaded object does not match declared metadata")
	ErrInvalidStorage = errors.New("invalid object storage configuration")
)

type UploadGrant struct {
	URL       string
	Method    string
	Headers   map[string]string
	ExpiresAt time.Time
}

type ObjectInfo struct {
	SizeBytes int64
	SHA256    string
}

type Storage interface {
	PresignUpload(context.Context, string, int64, []byte, time.Duration) (UploadGrant, error)
	Head(context.Context, string) (ObjectInfo, error)
	Delete(context.Context, string) error
	Read(context.Context, string, int64) ([]byte, error)
}

type Prober interface {
	Probe(context.Context) StorageProbeResult
}

type OSSStorage struct {
	client      *oss.Client
	probeClient ossObjectClient
	bucket      string
}

type ossObjectClient interface {
	PutObject(context.Context, *oss.PutObjectRequest, ...func(*oss.Options)) (*oss.PutObjectResult, error)
	GetObject(context.Context, *oss.GetObjectRequest, ...func(*oss.Options)) (*oss.GetObjectResult, error)
	DeleteObject(context.Context, *oss.DeleteObjectRequest, ...func(*oss.Options)) (*oss.DeleteObjectResult, error)
}

type StorageProbeStep struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	ErrorCode string `json:"errorCode,omitempty"`
	LatencyMS int64  `json:"latencyMs"`
}

type StorageProbeResult struct {
	Success    bool               `json:"success"`
	ErrorCode  string             `json:"errorCode,omitempty"`
	StartedAt  time.Time          `json:"startedAt"`
	DurationMS int64              `json:"durationMs"`
	Steps      []StorageProbeStep `json:"steps"`
	// Warnings describe limits that do not stop storage from working, such as
	// "delete_forbidden": uploads and symbolication work, deletions leave objects.
	Warnings []string `json:"warnings,omitempty"`
}

func NewOSSStorage(region, endpoint, bucket string) (*OSSStorage, error) {
	return newOSSStorage(region, endpoint, bucket, "", "")
}

func NewOSSStorageWithCredentials(region, endpoint, bucket, accessKeyID, secretAccessKey string) (*OSSStorage, error) {
	return newOSSStorage(region, endpoint, bucket, accessKeyID, secretAccessKey)
}

func newOSSStorage(region, endpoint, bucket, accessKeyID, secretAccessKey string) (*OSSStorage, error) {
	region, endpoint, bucket = strings.TrimSpace(region), strings.TrimSpace(endpoint), strings.TrimSpace(bucket)
	if region == "" || bucket == "" {
		return nil, ErrInvalidStorage
	}
	provider := credentials.NewEcsRoleCredentialsProvider()
	if accessKeyID != "" && secretAccessKey != "" {
		provider = credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey)
	} else if strings.TrimSpace(os.Getenv("OSS_ACCESS_KEY_ID")) != "" {
		provider = credentials.NewEnvironmentVariableCredentialsProvider()
	}
	configuration := oss.LoadDefaultConfig().
		WithCredentialsProvider(provider).
		WithRegion(region)
	if endpoint != "" {
		configuration = configuration.WithEndpoint(endpoint)
		if parsed, err := url.Parse(endpoint); err == nil && !isAlibabaOSSEndpoint(parsed.Hostname()) {
			configuration = configuration.WithUsePathStyle(true)
		}
	}
	client := oss.NewClient(configuration)
	return &OSSStorage{client: client, probeClient: client, bucket: bucket}, nil
}

func isAlibabaOSSEndpoint(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "aliyuncs.com" || strings.HasSuffix(host, ".aliyuncs.com")
}

func (storage *OSSStorage) Probe(ctx context.Context) (result StorageProbeResult) {
	startedAt := time.Now().UTC()
	result = StorageProbeResult{StartedAt: startedAt, Steps: make([]StorageProbeStep, 0, 3)}
	defer func() { result.DurationMS = time.Since(startedAt).Milliseconds() }()
	if storage == nil || storage.probeClient == nil || strings.TrimSpace(storage.bucket) == "" {
		result.ErrorCode = "not_configured"
		return result
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		result.ErrorCode = "internal"
		return result
	}
	key := "openrum-diagnostics/connectivity/" + hex.EncodeToString(random[:12])
	body := []byte("openrum-storage-probe:" + hex.EncodeToString(random[12:]))
	contentType := "text/plain"

	stepStarted := time.Now()
	_, writeErr := storage.probeClient.PutObject(ctx, &oss.PutObjectRequest{
		Bucket: oss.Ptr(storage.bucket), Key: oss.Ptr(key), Body: bytes.NewReader(body),
		ContentLength: oss.Ptr(int64(len(body))), ContentType: &contentType, ForbidOverwrite: oss.Ptr("true"),
	})
	result.Steps = append(result.Steps, probeStep("write", writeErr, stepStarted))
	if writeErr != nil {
		result.ErrorCode = classifyStorageProbeError(ctx, writeErr)
		result.Steps = append(result.Steps, storage.cleanupProbeObject(key))
		return result
	}

	stepStarted = time.Now()
	readResult, readErr := storage.probeClient.GetObject(ctx, &oss.GetObjectRequest{Bucket: oss.Ptr(storage.bucket), Key: oss.Ptr(key)})
	if readErr == nil {
		var contents []byte
		contents, readErr = io.ReadAll(io.LimitReader(readResult.Body, int64(len(body)+1)))
		_ = readResult.Body.Close()
		if readErr == nil && !bytes.Equal(contents, body) {
			readErr = ErrObjectMismatch
		}
	}
	result.Steps = append(result.Steps, probeStep("read", readErr, stepStarted))
	cleanup := storage.cleanupProbeObject(key)
	result.Steps = append(result.Steps, cleanup)
	if readErr != nil {
		result.ErrorCode = classifyStorageProbeError(ctx, readErr)
		return result
	}
	finishProbe(&result, cleanup)
	return result
}

func (storage *OSSStorage) cleanupProbeObject(key string) StorageProbeStep {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started := time.Now()
	_, err := storage.probeClient.DeleteObject(ctx, &oss.DeleteObjectRequest{Bucket: oss.Ptr(storage.bucket), Key: oss.Ptr(key)})
	return probeStep("delete", err, started)
}

func probeStep(name string, err error, started time.Time) StorageProbeStep {
	step := StorageProbeStep{Name: name, Status: "passed", LatencyMS: time.Since(started).Milliseconds()}
	if err != nil {
		step.Status = "failed"
		step.ErrorCode = classifyStorageProbeError(context.Background(), err)
	}
	return step
}

// finishProbe settles a probe whose write and read passed. A failed delete does
// not make storage unusable — uploads and symbolication only write and read — so
// it is a warning: deletions will leave objects behind and the probe object
// itself may remain under openrum-diagnostics/.
func finishProbe(result *StorageProbeResult, cleanup StorageProbeStep) {
	result.Success = true
	if cleanup.Status == "passed" {
		return
	}
	if cleanup.ErrorCode == "forbidden" || cleanup.ErrorCode == "credentials" {
		result.Warnings = append(result.Warnings, "delete_forbidden")
		return
	}
	result.Warnings = append(result.Warnings, "cleanup_failed")
}

// IsForbidden reports a provider refusal (HTTP 403), for example a credential
// that may write and read objects but not delete them.
func IsForbidden(err error) bool {
	return storageHTTPStatus(err) == 403
}

func classifyStorageProbeError(ctx context.Context, err error) string {
	if errors.Is(err, ErrObjectMismatch) {
		return "integrity"
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	var serviceError interface {
		HttpStatusCode() int
		ErrorCode() string
	}
	if errors.As(err, &serviceError) {
		switch serviceError.HttpStatusCode() {
		case 400:
			if strings.EqualFold(serviceError.ErrorCode(), "InvalidRequest") {
				return "incompatible_endpoint"
			}
		case 401:
			return "credentials"
		case 403:
			return "forbidden"
		case 404:
			return "bucket_not_found"
		}
	}
	// The S3 SDK exposes the status as HTTPStatusCode rather than HttpStatusCode.
	switch storageHTTPStatus(err) {
	case 401:
		return "credentials"
	case 403:
		return "forbidden"
	case 404:
		return "bucket_not_found"
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "credential") || strings.Contains(message, "accesskey") {
		return "credentials"
	}
	return "network"
}

func (storage *OSSStorage) PresignUpload(ctx context.Context, key string, size int64, digest []byte, ttl time.Duration) (UploadGrant, error) {
	if strings.TrimSpace(key) == "" || size < 0 || len(digest) != 32 || ttl <= 0 || ttl > MaxPresignTTL {
		return UploadGrant{}, ErrObjectMismatch
	}
	digestHex := hex.EncodeToString(digest)
	contentType := "application/json"
	result, err := storage.client.Presign(ctx, &oss.PutObjectRequest{
		Bucket: oss.Ptr(storage.bucket), Key: oss.Ptr(key), ContentLength: oss.Ptr(size), ContentType: &contentType,
		Metadata: map[string]string{"sha256": digestHex}, ForbidOverwrite: oss.Ptr("true"),
	}, oss.PresignExpires(ttl))
	if err != nil {
		return UploadGrant{}, fmt.Errorf("presign OSS upload: %w", err)
	}
	return UploadGrant{URL: result.URL, Method: result.Method, Headers: result.SignedHeaders, ExpiresAt: result.Expiration}, nil
}

func (storage *OSSStorage) Head(ctx context.Context, key string) (ObjectInfo, error) {
	result, err := storage.client.HeadObject(ctx, &oss.HeadObjectRequest{Bucket: oss.Ptr(storage.bucket), Key: oss.Ptr(key)})
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("head OSS object: %w", err)
	}
	return ObjectInfo{SizeBytes: result.ContentLength, SHA256: strings.ToLower(result.Metadata["sha256"])}, nil
}

func (storage *OSSStorage) Delete(ctx context.Context, key string) error {
	_, err := storage.client.DeleteObject(ctx, &oss.DeleteObjectRequest{Bucket: oss.Ptr(storage.bucket), Key: oss.Ptr(key)})
	if err != nil {
		return fmt.Errorf("delete OSS object: %w", err)
	}
	return nil
}

func (storage *OSSStorage) Read(ctx context.Context, key string, maximum int64) ([]byte, error) {
	if maximum <= 0 || maximum > MaxMapBytes {
		return nil, ErrObjectMismatch
	}
	result, err := storage.client.GetObject(ctx, &oss.GetObjectRequest{Bucket: oss.Ptr(storage.bucket), Key: oss.Ptr(key)})
	if err != nil {
		return nil, fmt.Errorf("get OSS object: %w", err)
	}
	defer func() { _ = result.Body.Close() }()
	if result.ContentLength > maximum {
		return nil, &ResolveError{Code: FailureResourceLimit, Err: errors.New("source map is too large")}
	}
	contents, err := io.ReadAll(io.LimitReader(result.Body, maximum+1))
	if err != nil {
		return nil, fmt.Errorf("read OSS object: %w", err)
	}
	if int64(len(contents)) > maximum {
		return nil, &ResolveError{Code: FailureResourceLimit, Err: errors.New("source map is too large")}
	}
	return contents, nil
}

func VerifyObject(info ObjectInfo, expectedSize int64, expectedDigest []byte) error {
	if info.SizeBytes != expectedSize || !strings.EqualFold(info.SHA256, hex.EncodeToString(expectedDigest)) {
		return ErrObjectMismatch
	}
	return nil
}
