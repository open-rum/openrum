package sourcemap

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsv4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	awscredentials "github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

type s3ObjectClient interface {
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	HeadObject(context.Context, *s3.HeadObjectInput, ...func(*s3.Options)) (*s3.HeadObjectOutput, error)
	DeleteObject(context.Context, *s3.DeleteObjectInput, ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}

type s3PresignClient interface {
	PresignPutObject(context.Context, *s3.PutObjectInput, ...func(*s3.PresignOptions)) (*awsv4.PresignedHTTPRequest, error)
}

type S3Storage struct {
	client    s3ObjectClient
	presigner s3PresignClient
	bucket    string
}

func NewS3Storage(ctx context.Context, region, endpoint, bucket string, forcePathStyle bool) (*S3Storage, error) {
	return newS3Storage(ctx, region, endpoint, bucket, forcePathStyle, "", "")
}

func NewS3StorageWithCredentials(ctx context.Context, region, endpoint, bucket string, forcePathStyle bool, accessKeyID, secretAccessKey string) (*S3Storage, error) {
	return newS3Storage(ctx, region, endpoint, bucket, forcePathStyle, accessKeyID, secretAccessKey)
}

func newS3Storage(ctx context.Context, region, endpoint, bucket string, forcePathStyle bool, accessKeyID, secretAccessKey string) (*S3Storage, error) {
	region, endpoint, bucket = strings.TrimSpace(region), strings.TrimSpace(endpoint), strings.TrimSpace(bucket)
	if region == "" || bucket == "" {
		return nil, ErrInvalidStorage
	}
	options := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(region)}
	if accessKeyID != "" && secretAccessKey != "" {
		options = append(options, awsconfig.WithCredentialsProvider(awscredentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, "")))
	}
	configuration, err := awsconfig.LoadDefaultConfig(ctx, options...)
	if err != nil {
		return nil, fmt.Errorf("load S3 configuration: %w", err)
	}
	client := s3.NewFromConfig(configuration, func(options *s3.Options) {
		options.UsePathStyle = forcePathStyle
		if endpoint != "" {
			options.BaseEndpoint = aws.String(endpoint)
		}
	})
	return &S3Storage{client: client, presigner: s3.NewPresignClient(client), bucket: bucket}, nil
}

func (storage *S3Storage) Probe(ctx context.Context) (result StorageProbeResult) {
	startedAt := time.Now().UTC()
	result = StorageProbeResult{StartedAt: startedAt, Steps: make([]StorageProbeStep, 0, 3)}
	defer func() { result.DurationMS = time.Since(startedAt).Milliseconds() }()
	if storage == nil || storage.client == nil || strings.TrimSpace(storage.bucket) == "" {
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
	_, writeErr := storage.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(storage.bucket), Key: aws.String(key), Body: bytes.NewReader(body),
		ContentLength: aws.Int64(int64(len(body))), ContentType: &contentType, IfNoneMatch: aws.String("*"),
	})
	result.Steps = append(result.Steps, probeStep("write", writeErr, stepStarted))
	if writeErr != nil {
		result.ErrorCode = classifyS3ProbeError(ctx, writeErr)
		result.Steps = append(result.Steps, storage.cleanupProbeObject(key))
		return result
	}

	stepStarted = time.Now()
	readResult, readErr := storage.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(storage.bucket), Key: aws.String(key)})
	if readErr == nil {
		contents, err := io.ReadAll(io.LimitReader(readResult.Body, int64(len(body)+1)))
		_ = readResult.Body.Close()
		readErr = err
		if readErr == nil && !bytes.Equal(contents, body) {
			readErr = ErrObjectMismatch
		}
	}
	result.Steps = append(result.Steps, probeStep("read", readErr, stepStarted))
	cleanup := storage.cleanupProbeObject(key)
	result.Steps = append(result.Steps, cleanup)
	if readErr != nil {
		result.ErrorCode = classifyS3ProbeError(ctx, readErr)
		return result
	}
	if cleanup.Status != "passed" {
		result.ErrorCode = "cleanup_failed"
		return result
	}
	result.Success = true
	return result
}

func (storage *S3Storage) cleanupProbeObject(key string) StorageProbeStep {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started := time.Now()
	_, err := storage.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(storage.bucket), Key: aws.String(key)})
	return probeStep("delete", err, started)
}

func classifyS3ProbeError(ctx context.Context, err error) string {
	if errors.Is(err, ErrObjectMismatch) {
		return "integrity"
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	var responseError *smithyhttp.ResponseError
	var apiError smithy.APIError
	status, code := 0, ""
	if errors.As(err, &responseError) {
		status = responseError.HTTPStatusCode()
	}
	if errors.As(err, &apiError) {
		code = apiError.ErrorCode()
	}
	switch status {
	case 400:
		if strings.EqualFold(code, "InvalidRequest") || strings.EqualFold(code, "AuthorizationHeaderMalformed") {
			return "incompatible_endpoint"
		}
	case 401:
		return "credentials"
	case 403:
		return "forbidden"
	case 404:
		return "bucket_not_found"
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "credential") || strings.Contains(message, "access key") {
		return "credentials"
	}
	return "network"
}

func (storage *S3Storage) PresignUpload(ctx context.Context, key string, size int64, digest []byte, ttl time.Duration) (UploadGrant, error) {
	if strings.TrimSpace(key) == "" || size < 0 || len(digest) != 32 || ttl <= 0 || ttl > MaxPresignTTL {
		return UploadGrant{}, ErrObjectMismatch
	}
	contentType := "application/json"
	result, err := storage.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(storage.bucket), Key: aws.String(key), ContentLength: aws.Int64(size), ContentType: &contentType,
		Metadata: map[string]string{"sha256": hex.EncodeToString(digest)}, IfNoneMatch: aws.String("*"),
	}, func(options *s3.PresignOptions) { options.Expires = ttl })
	if err != nil {
		return UploadGrant{}, fmt.Errorf("presign S3 upload: %w", err)
	}
	headers := make(map[string]string, len(result.SignedHeader))
	for name, values := range result.SignedHeader {
		headers[name] = strings.Join(values, ",")
	}
	return UploadGrant{URL: result.URL, Method: result.Method, Headers: headers, ExpiresAt: time.Now().UTC().Add(ttl)}, nil
}

func (storage *S3Storage) Head(ctx context.Context, key string) (ObjectInfo, error) {
	result, err := storage.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(storage.bucket), Key: aws.String(key)})
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("head S3 object: %w", err)
	}
	return ObjectInfo{SizeBytes: aws.ToInt64(result.ContentLength), SHA256: strings.ToLower(result.Metadata["sha256"])}, nil
}

func (storage *S3Storage) Delete(ctx context.Context, key string) error {
	_, err := storage.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(storage.bucket), Key: aws.String(key)})
	if err != nil {
		return fmt.Errorf("delete S3 object: %w", err)
	}
	return nil
}

func (storage *S3Storage) Read(ctx context.Context, key string, maximum int64) ([]byte, error) {
	if maximum <= 0 || maximum > MaxMapBytes {
		return nil, ErrObjectMismatch
	}
	result, err := storage.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(storage.bucket), Key: aws.String(key)})
	if err != nil {
		return nil, fmt.Errorf("get S3 object: %w", err)
	}
	defer func() { _ = result.Body.Close() }()
	if aws.ToInt64(result.ContentLength) > maximum {
		return nil, &ResolveError{Code: FailureResourceLimit, Err: errors.New("source map is too large")}
	}
	contents, err := io.ReadAll(io.LimitReader(result.Body, maximum+1))
	if err != nil {
		return nil, fmt.Errorf("read S3 object: %w", err)
	}
	if int64(len(contents)) > maximum {
		return nil, &ResolveError{Code: FailureResourceLimit, Err: errors.New("source map is too large")}
	}
	return contents, nil
}
