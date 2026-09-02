package ingest

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	MaxCompressedBodyBytes = 256 * 1024
	MaxRawBodyBytes        = 1024 * 1024
	MaxDecompressionRatio  = 100

	defaultIPRequestsPerSecond      = 1_000
	defaultProjectRequestsPerSecond = 5_000
)

var (
	ErrPayloadTooLarge     = errors.New("ingest payload is too large")
	ErrUnsupportedEncoding = errors.New("unsupported content encoding")
	ErrInvalidCompression  = errors.New("invalid compressed payload")
	ErrUnsupportedMedia    = errors.New("content type must be application/json")
)

type RateLimiter interface {
	AllowIP(context.Context, string) bool
	AllowProject(context.Context, uuid.UUID) bool
}

type RedisRateLimiter struct {
	client       *redis.Client
	local        *localRateLimiter
	ipLimit      int64
	projectLimit int64
}

var fixedWindowScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 2) end
if count > tonumber(ARGV[1]) then return 0 end
return 1
`)

func NewRedisRateLimiter(client *redis.Client) *RedisRateLimiter {
	return &RedisRateLimiter{
		client:       client,
		local:        newLocalRateLimiter(defaultIPRequestsPerSecond/2, defaultProjectRequestsPerSecond/2),
		ipLimit:      defaultIPRequestsPerSecond,
		projectLimit: defaultProjectRequestsPerSecond,
	}
}

func (limiter *RedisRateLimiter) AllowIP(ctx context.Context, address string) bool {
	digest := sha256.Sum256([]byte(address))
	key := fmt.Sprintf("openrum:ingest:ip:%x:%d", digest[:8], time.Now().Unix())
	if allowed, err := limiter.allowRedis(ctx, key, limiter.ipLimit); err == nil {
		return allowed
	}
	return limiter.local.allow("ip:"+string(digest[:]), limiter.local.ipLimit)
}

func (limiter *RedisRateLimiter) AllowProject(ctx context.Context, projectID uuid.UUID) bool {
	key := fmt.Sprintf("openrum:ingest:{%s}:project:%d", projectID, time.Now().Unix())
	if allowed, err := limiter.allowRedis(ctx, key, limiter.projectLimit); err == nil {
		return allowed
	}
	return limiter.local.allow("project:"+projectID.String(), limiter.local.projectLimit)
}

func (limiter *RedisRateLimiter) allowRedis(ctx context.Context, key string, limit int64) (bool, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	allowed, err := fixedWindowScript.Run(requestCtx, limiter.client, []string{key}, limit).Int()
	if err != nil {
		return false, err
	}
	return allowed == 1, nil
}

type localRateLimiter struct {
	mutex        sync.Mutex
	windows      map[string]localWindow
	ipLimit      int64
	projectLimit int64
}

type localWindow struct {
	second int64
	count  int64
}

func newLocalRateLimiter(ipLimit, projectLimit int64) *localRateLimiter {
	return &localRateLimiter{windows: make(map[string]localWindow), ipLimit: ipLimit, projectLimit: projectLimit}
}

func (limiter *localRateLimiter) allow(key string, limit int64) bool {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	second := time.Now().Unix()
	window := limiter.windows[key]
	if window.second != second {
		window = localWindow{second: second}
	}
	window.count++
	limiter.windows[key] = window
	if len(limiter.windows) > 10_000 {
		for currentKey, current := range limiter.windows {
			if current.second < second {
				delete(limiter.windows, currentKey)
			}
		}
	}
	return window.count <= limit
}

func ReadEnvelopeBody(request *http.Request) ([]byte, error) {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return nil, ErrUnsupportedMedia
	}
	encoding := strings.ToLower(strings.TrimSpace(request.Header.Get("Content-Encoding")))
	if encoding == "" || encoding == "identity" {
		return readBounded(request.Body, MaxRawBodyBytes)
	}
	if encoding != "gzip" {
		return nil, ErrUnsupportedEncoding
	}
	if request.ContentLength > MaxCompressedBodyBytes {
		return nil, ErrPayloadTooLarge
	}
	compressed, err := readBounded(request.Body, MaxCompressedBodyBytes)
	if err != nil {
		return nil, err
	}
	compressedReader := bytes.NewReader(compressed)
	gzipReader, err := gzip.NewReader(compressedReader)
	if err != nil {
		return nil, ErrInvalidCompression
	}
	gzipReader.Multistream(false)
	decompressed, readErr := readBounded(gzipReader, MaxRawBodyBytes)
	closeErr := gzipReader.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil || compressedReader.Len() != 0 {
		return nil, ErrInvalidCompression
	}
	if len(compressed) > 0 && len(decompressed) > len(compressed)*MaxDecompressionRatio {
		return nil, ErrPayloadTooLarge
	}
	return decompressed, nil
}

func readBounded(reader io.Reader, maximum int64) ([]byte, error) {
	contents, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(contents)) > maximum {
		return nil, ErrPayloadTooLarge
	}
	return contents, nil
}
