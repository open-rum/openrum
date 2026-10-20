package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	accountFailureLimit = 5
	ipFailureLimit      = 30
	loginFailureWindow  = 15 * time.Minute
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrLoginRateLimited   = errors.New("login rate limited")
	// ErrEmailNotVerified is returned for the right password on an account whose address has
	// not been confirmed yet. It is only said after the password matched, so it does not tell
	// a stranger which addresses are registered.
	ErrEmailNotVerified = errors.New("email address is not verified")
)

type AuthenticatedUser struct {
	ID          uuid.UUID
	Email       string
	DisplayName string
	// AccessStatus is "pending" for an account still waiting for an organization to take
	// it in. It may sign in, but every route except /auth/me and /auth/logout refuses it.
	AccessStatus string
}

type FailureLimiter interface {
	Allow(context.Context, string, string) bool
	Failed(context.Context, string, string)
	Succeeded(context.Context, string)
}

type LoginManager struct {
	database       *sql.DB
	limiter        FailureLimiter
	dummyHash      string
	verifyPassword func(string, string) (bool, error)
}

func NewLoginManager(database *sql.DB, limiter FailureLimiter) (*LoginManager, error) {
	dummyHash, err := HashPassword("Openrum-dummy-password!")
	if err != nil {
		return nil, err
	}
	return &LoginManager{
		database:       database,
		limiter:        limiter,
		dummyHash:      dummyHash,
		verifyPassword: VerifyPassword,
	}, nil
}

func (manager *LoginManager) Authenticate(ctx context.Context, email, password, ipAddress string) (AuthenticatedUser, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !manager.limiter.Allow(ctx, ipAddress, email) {
		return AuthenticatedUser{}, ErrLoginRateLimited
	}

	var user AuthenticatedUser
	var passwordHash sql.NullString
	var status string
	err := manager.database.QueryRowContext(ctx,
		"SELECT id, email, display_name, password_hash, status, access_status FROM users WHERE email=$1",
		email,
	).Scan(&user.ID, &user.Email, &user.DisplayName, &passwordHash, &status, &user.AccessStatus)
	if errors.Is(err, sql.ErrNoRows) {
		_, _ = manager.verifyPassword(password, manager.dummyHash)
		manager.limiter.Failed(ctx, ipAddress, email)
		return AuthenticatedUser{}, ErrInvalidCredentials
	}
	if err != nil {
		return AuthenticatedUser{}, fmt.Errorf("load local login user: %w", err)
	}
	if !passwordHash.Valid {
		_, _ = manager.verifyPassword(password, manager.dummyHash)
		manager.limiter.Failed(ctx, ipAddress, email)
		return AuthenticatedUser{}, ErrInvalidCredentials
	}
	valid, err := manager.verifyPassword(password, passwordHash.String)
	if err != nil {
		return AuthenticatedUser{}, err
	}
	if !valid || status != "active" {
		manager.limiter.Failed(ctx, ipAddress, email)
		return AuthenticatedUser{}, ErrInvalidCredentials
	}
	manager.limiter.Succeeded(ctx, email)
	if user.AccessStatus == "unverified" {
		return AuthenticatedUser{}, ErrEmailNotVerified
	}
	return user, nil
}

type RedisFailureLimiter struct {
	client   redis.UniversalClient
	fallback *memoryFailureLimiter
}

func NewRedisFailureLimiter(client redis.UniversalClient) *RedisFailureLimiter {
	return &RedisFailureLimiter{
		client:   client,
		fallback: newMemoryFailureLimiter(3, 10, loginFailureWindow),
	}
}

func (limiter *RedisFailureLimiter) Allow(ctx context.Context, ipAddress, account string) bool {
	accountKey, ipKey := loginLimitKeys(ipAddress, account)
	values, err := limiter.client.MGet(ctx, accountKey, ipKey).Result()
	if err != nil {
		return limiter.fallback.Allow(ctx, ipAddress, account)
	}
	return redisCount(values[0]) < accountFailureLimit && redisCount(values[1]) < ipFailureLimit
}

func (limiter *RedisFailureLimiter) Failed(ctx context.Context, ipAddress, account string) {
	limiter.fallback.Failed(ctx, ipAddress, account)
	accountKey, ipKey := loginLimitKeys(ipAddress, account)
	pipeline := limiter.client.TxPipeline()
	pipeline.Incr(ctx, accountKey)
	pipeline.Expire(ctx, accountKey, loginFailureWindow)
	pipeline.Incr(ctx, ipKey)
	pipeline.Expire(ctx, ipKey, loginFailureWindow)
	_, _ = pipeline.Exec(ctx)
}

func (limiter *RedisFailureLimiter) Succeeded(ctx context.Context, account string) {
	accountKey := "openrum:login:account:" + digestLoginDimension(account)
	_ = limiter.client.Del(ctx, accountKey).Err()
	limiter.fallback.Succeeded(ctx, account)
}

func loginLimitKeys(ipAddress, account string) (string, string) {
	return "openrum:login:account:" + digestLoginDimension(account),
		"openrum:login:ip:" + digestLoginDimension(ipAddress)
}

func digestLoginDimension(value string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(value))))
	return hex.EncodeToString(digest[:])
}

func redisCount(value any) int {
	switch typed := value.(type) {
	case int64:
		return int(typed)
	case string:
		count, _ := strconv.Atoi(typed)
		return count
	default:
		return 0
	}
}

type memoryFailureLimiter struct {
	mutex        sync.Mutex
	accounts     map[string]failureCounter
	ipAddresses  map[string]failureCounter
	accountLimit int
	ipLimit      int
	window       time.Duration
	now          func() time.Time
}

type failureCounter struct {
	count     int
	expiresAt time.Time
}

func newMemoryFailureLimiter(accountLimit, ipLimit int, window time.Duration) *memoryFailureLimiter {
	return &memoryFailureLimiter{
		accounts:     make(map[string]failureCounter),
		ipAddresses:  make(map[string]failureCounter),
		accountLimit: accountLimit,
		ipLimit:      ipLimit,
		window:       window,
		now:          time.Now,
	}
}

func (limiter *memoryFailureLimiter) Allow(_ context.Context, ipAddress, account string) bool {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	now := limiter.now()
	accountCounter := activeCounter(limiter.accounts[account], now)
	ipCounter := activeCounter(limiter.ipAddresses[ipAddress], now)
	return accountCounter.count < limiter.accountLimit && ipCounter.count < limiter.ipLimit
}

func (limiter *memoryFailureLimiter) Failed(_ context.Context, ipAddress, account string) {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	now := limiter.now()
	limiter.accounts[account] = incrementCounter(limiter.accounts[account], now, limiter.window)
	limiter.ipAddresses[ipAddress] = incrementCounter(limiter.ipAddresses[ipAddress], now, limiter.window)
}

func (limiter *memoryFailureLimiter) Succeeded(_ context.Context, account string) {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	delete(limiter.accounts, account)
}

func activeCounter(counter failureCounter, now time.Time) failureCounter {
	if !counter.expiresAt.After(now) {
		return failureCounter{}
	}
	return counter
}

func incrementCounter(counter failureCounter, now time.Time, window time.Duration) failureCounter {
	counter = activeCounter(counter, now)
	counter.count++
	counter.expiresAt = now.Add(window)
	return counter
}
