package ingest

import (
	"context"
	"crypto/sha256"
	"errors"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"openrum/internal/metadata"
)

const (
	validKeyCacheTTL   = 30 * time.Second
	invalidKeyCacheTTL = 10 * time.Second
	maxKeyCacheEntries = 10_000
)

type ProjectKeyValidator interface {
	Validate(context.Context, string) (metadata.ProjectKeyAccess, error)
}

type Authenticator interface {
	Authenticate(context.Context, string) (metadata.ProjectKeyAccess, error)
}

type CachedAuthenticator struct {
	validator ProjectKeyValidator
	now       func() time.Time
	mutex     sync.Mutex
	entries   map[[sha256.Size]byte]authenticationCacheEntry
	flights   singleflight.Group
}

type authenticationCacheEntry struct {
	access    metadata.ProjectKeyAccess
	invalid   bool
	expiresAt time.Time
}

func NewCachedAuthenticator(validator ProjectKeyValidator) *CachedAuthenticator {
	return &CachedAuthenticator{
		validator: validator,
		now:       time.Now,
		entries:   make(map[[sha256.Size]byte]authenticationCacheEntry),
	}
}

func (authenticator *CachedAuthenticator) Authenticate(ctx context.Context, raw string) (metadata.ProjectKeyAccess, error) {
	digest := sha256.Sum256([]byte(raw))
	if access, found, invalid := authenticator.cached(digest); found {
		if invalid {
			return metadata.ProjectKeyAccess{}, metadata.ErrInvalidProjectKey
		}
		return access, nil
	}
	value, err, _ := authenticator.flights.Do(string(digest[:]), func() (any, error) {
		if access, found, invalid := authenticator.cached(digest); found {
			if invalid {
				return metadata.ProjectKeyAccess{}, metadata.ErrInvalidProjectKey
			}
			return access, nil
		}
		now := authenticator.now()
		access, validateErr := authenticator.validator.Validate(ctx, raw)
		if validateErr != nil {
			if errors.Is(validateErr, metadata.ErrInvalidProjectKey) || errors.Is(validateErr, metadata.ErrProjectKeyRevoked) {
				authenticator.store(digest, authenticationCacheEntry{invalid: true, expiresAt: now.Add(invalidKeyCacheTTL)})
				return metadata.ProjectKeyAccess{}, metadata.ErrInvalidProjectKey
			}
			return metadata.ProjectKeyAccess{}, validateErr
		}
		authenticator.store(digest, authenticationCacheEntry{access: access, expiresAt: now.Add(validKeyCacheTTL)})
		return access, nil
	})
	if err != nil {
		return metadata.ProjectKeyAccess{}, err
	}
	return value.(metadata.ProjectKeyAccess), nil
}

func (authenticator *CachedAuthenticator) cached(digest [sha256.Size]byte) (metadata.ProjectKeyAccess, bool, bool) {
	now := authenticator.now()
	authenticator.mutex.Lock()
	defer authenticator.mutex.Unlock()
	entry, found := authenticator.entries[digest]
	if found && now.Before(entry.expiresAt) {
		return entry.access, true, entry.invalid
	}
	if found {
		delete(authenticator.entries, digest)
	}
	return metadata.ProjectKeyAccess{}, false, false
}

func (authenticator *CachedAuthenticator) store(digest [sha256.Size]byte, entry authenticationCacheEntry) {
	authenticator.mutex.Lock()
	defer authenticator.mutex.Unlock()
	if len(authenticator.entries) >= maxKeyCacheEntries {
		now := authenticator.now()
		for key, current := range authenticator.entries {
			if !now.Before(current.expiresAt) {
				delete(authenticator.entries, key)
			}
		}
	}
	if len(authenticator.entries) < maxKeyCacheEntries {
		authenticator.entries[digest] = entry
	}
}
