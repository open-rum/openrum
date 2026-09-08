package ingest

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
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

	"openrum/internal/metadata"
)

const (
	MaxCompressedBodyBytes = 256 * 1024
	MaxRawBodyBytes        = 1024 * 1024
	MaxDecompressionRatio  = 100

	defaultIPRequestsPerSecond = 1_000

	// DefaultProjectRequestsPerSecond applies to a project that has set no
	// limit of its own. It is exported because the Console shows what the
	// default currently is next to the override field, and a number copied
	// into the UI would drift from this one.
	DefaultProjectRequestsPerSecond = 5_000

	// maxSampleOvershoot bounds a window's admissions in sample mode, as a
	// multiple of the limit.
	//
	// Thinning by caller keeps the admitted rate near the limit but not under
	// it: the share is recomputed as the window fills, and the requests
	// admitted before it tightened have already gone through. Left alone the
	// excess grows with the logarithm of the offered load. The ceiling turns
	// that into a fixed worst case, which is what makes the mode safe to offer
	// as an alternative to an exact cap rather than as a way around one.
	maxSampleOvershoot = 2
)

var (
	ErrPayloadTooLarge     = errors.New("ingest payload is too large")
	ErrUnsupportedEncoding = errors.New("unsupported content encoding")
	ErrInvalidCompression  = errors.New("invalid compressed payload")
	ErrUnsupportedMedia    = errors.New("content type must be application/json")
)

// ProjectQuota is what a project asked for, resolved for one request.
type ProjectQuota struct {
	// RequestsPerSecond is the project's override. Zero means the default.
	RequestsPerSecond int32
	Behavior          metadata.OverLimitBehavior
}

// Limit returns the ceiling to enforce.
func (quota ProjectQuota) Limit() int64 {
	if quota.RequestsPerSecond > 0 {
		return int64(quota.RequestsPerSecond)
	}
	return DefaultProjectRequestsPerSecond
}

type RateLimiter interface {
	AllowIP(context.Context, string) bool
	// AllowProject decides one request against the project's own quota. The
	// caller identity is passed because sample mode sheds whole callers rather
	// than whichever requests happen to arrive late in a window.
	AllowProject(ctx context.Context, projectID uuid.UUID, quota ProjectQuota, caller string) bool
}

type RedisRateLimiter struct {
	client  *redis.Client
	local   *localRateLimiter
	ipLimit int64
}

var fixedWindowScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 2) end
if count > tonumber(ARGV[1]) then return 0 end
return 1
`)

// projectWindowScript counts one request and reports what the decision needs:
// this second's offered total, the previous second's, and how many over-limit
// requests this second has already admitted.
//
// The decision itself is made in Go. It depends on the project's behaviour
// setting and on a hash of the caller, and keeping it out of Lua is what lets
// it be tested directly rather than through a Redis instance.
//
// Keys expire after three seconds rather than two so that the previous window
// is still readable while the current one is being counted.
var projectWindowScript = redis.NewScript(`
local offered = redis.call('INCR', KEYS[1])
if offered == 1 then redis.call('EXPIRE', KEYS[1], 3) end
return {offered, tonumber(redis.call('GET', KEYS[2]) or '0'), tonumber(redis.call('GET', KEYS[3]) or '0')}
`)

// projectAdmitScript records an over-limit admission. It runs only in sample
// mode and only when a request got through, so the common path still costs one
// round trip.
var projectAdmitScript = redis.NewScript(`
local admitted = redis.call('INCR', KEYS[1])
if admitted == 1 then redis.call('EXPIRE', KEYS[1], 3) end
return admitted
`)

func NewRedisRateLimiter(client *redis.Client) *RedisRateLimiter {
	return &RedisRateLimiter{
		client:  client,
		local:   newLocalRateLimiter(defaultIPRequestsPerSecond / 2),
		ipLimit: defaultIPRequestsPerSecond,
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

func (limiter *RedisRateLimiter) AllowProject(
	ctx context.Context,
	projectID uuid.UUID,
	quota ProjectQuota,
	caller string,
) bool {
	second := time.Now().Unix()
	// Every key carries the same hash tag so a cluster keeps them on one node
	// and one script can read all three.
	current := fmt.Sprintf("openrum:ingest:{%s}:project:%d", projectID, second)
	previous := fmt.Sprintf("openrum:ingest:{%s}:project:%d", projectID, second-1)
	admitted := fmt.Sprintf("openrum:ingest:{%s}:project:admitted:%d", projectID, second)
	offered, previousOffered, admittedOver, err := limiter.projectWindow(ctx, current, previous, admitted)
	if err != nil {
		// A local half-limit is what the process can defend on its own when
		// Redis is unreachable: every replica counts separately, so the shared
		// ceiling cannot be honoured and the conservative reading is to hold a
		// fraction of it per replica.
		return limiter.local.admitProject("project:"+projectID.String(), quota.Limit()/2, quota.Behavior, caller)
	}
	allowed := admitProject(offered, previousOffered, admittedOver, quota.Limit(), quota.Behavior, caller)
	if allowed && offered > quota.Limit() {
		limiter.recordAdmission(ctx, admitted)
	}
	return allowed
}

func (limiter *RedisRateLimiter) recordAdmission(ctx context.Context, key string) {
	requestCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	// A failure here loses one tick of the ceiling, which is a slightly looser
	// bound for one window. It is not worth refusing a request the limiter has
	// already decided to admit.
	_ = projectAdmitScript.Run(requestCtx, limiter.client, []string{key}).Err()
}

// admitProject decides one request that has already been counted.
//
// Under the limit the answer is yes in both modes. Over it, reject mode says no
// and the cap is exact. Sample mode instead admits a share of callers chosen by
// a hash of the caller, so a caller either passes for the whole window or does
// not, and a session is reported whole rather than with holes in it.
//
// The share is derived from the busier of the two windows. Using the previous
// window as well matters at the start of a burst: this window's count is still
// small, so on its own it would let the first requests of a spike through at
// full rate and only tighten afterwards.
//
// admittedOver counts what this window has already let through above the limit,
// and is what the overshoot ceiling is measured against. Counting offered
// requests instead would make the mode collapse under heavy load — a project
// three times over its limit would have every request refused, which is worse
// than the mode it was chosen over.
func admitProject(offered, previousOffered, admittedOver, limit int64, behavior metadata.OverLimitBehavior, caller string) bool {
	if limit < 1 {
		limit = 1
	}
	if offered <= limit {
		return true
	}
	if behavior != metadata.OverLimitSample || admittedOver >= limit*(maxSampleOvershoot-1) {
		return false
	}
	observed := max(previousOffered, offered)
	factor := (observed + limit - 1) / limit
	if factor < 2 {
		return false
	}
	return callerBucket(caller)%uint64(factor) == 0
}

// callerBucket maps a caller onto a stable number. It is hashed rather than
// used directly so that neighbouring addresses, which frequently belong to one
// network, do not all land in the same bucket and get shed together.
func callerBucket(caller string) uint64 {
	digest := sha256.Sum256([]byte("openrum:shed:" + caller))
	return binary.BigEndian.Uint64(digest[:8])
}

func (limiter *RedisRateLimiter) projectWindow(
	ctx context.Context,
	current, previous, admitted string,
) (int64, int64, int64, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	values, err := projectWindowScript.Run(requestCtx, limiter.client,
		[]string{current, previous, admitted}).Int64Slice()
	if err != nil {
		return 0, 0, 0, err
	}
	if len(values) != 3 {
		return 0, 0, 0, fmt.Errorf("project rate limit script returned %d values, want 3", len(values))
	}
	return values[0], values[1], values[2], nil
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
	mutex   sync.Mutex
	windows map[string]localWindow
	ipLimit int64
}

type localWindow struct {
	second       int64
	count        int64
	previous     int64
	admittedOver int64
}

func newLocalRateLimiter(ipLimit int64) *localRateLimiter {
	return &localRateLimiter{windows: make(map[string]localWindow), ipLimit: ipLimit}
}

// admitProject is the in-process stand-in for the Redis path, used when Redis
// is unreachable. It counts and decides under one lock so that the admission
// tally cannot drift from the decisions it bounds.
func (limiter *localRateLimiter) admitProject(
	key string,
	limit int64,
	behavior metadata.OverLimitBehavior,
	caller string,
) bool {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	second := time.Now().Unix()
	window := limiter.windows[key]
	switch {
	case window.second == second:
	case window.second == second-1:
		window = localWindow{second: second, previous: window.count}
	default:
		window = localWindow{second: second}
	}
	window.count++
	allowed := admitProject(window.count, window.previous, window.admittedOver, limit, behavior, caller)
	if allowed && window.count > limit {
		window.admittedOver++
	}
	limiter.windows[key] = window
	limiter.evict(second)
	return allowed
}

func (limiter *localRateLimiter) evict(second int64) {
	if len(limiter.windows) <= 10_000 {
		return
	}
	for key, current := range limiter.windows {
		if current.second < second-1 {
			delete(limiter.windows, key)
		}
	}
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
