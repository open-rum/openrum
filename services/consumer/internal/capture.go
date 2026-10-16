package consumerservice

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"openrum/internal/capture"
	"openrum/internal/event"
)

// APICaptureSettingsProvider supplies the compiled header capture rules for a
// project.
type APICaptureSettingsProvider interface {
	Get(context.Context, uuid.UUID) (*capture.Compiled, error)
}

type projectCaptureRepository interface {
	Get(context.Context, uuid.UUID) (capture.Settings, error)
}

type cachedCaptureSettings struct {
	compiled  *capture.Compiled
	expiresAt time.Time
}

// CachedAPICaptureSettingsProvider caches compiled rules for a short window, so
// that switching an endpoint off in the Console stops storage within one TTL
// without every message costing a database round trip.
type CachedAPICaptureSettingsProvider struct {
	repository projectCaptureRepository
	ttl        time.Duration
	now        func() time.Time
	mutex      sync.RWMutex
	entries    map[uuid.UUID]cachedCaptureSettings
}

func NewCachedAPICaptureSettingsProvider(repository projectCaptureRepository, ttl time.Duration) *CachedAPICaptureSettingsProvider {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &CachedAPICaptureSettingsProvider{
		repository: repository, ttl: ttl, now: time.Now,
		entries: make(map[uuid.UUID]cachedCaptureSettings),
	}
}

func (provider *CachedAPICaptureSettingsProvider) Get(ctx context.Context, projectID uuid.UUID) (*capture.Compiled, error) {
	now := provider.now().UTC()
	provider.mutex.RLock()
	entry, ok := provider.entries[projectID]
	provider.mutex.RUnlock()
	if ok && now.Before(entry.expiresAt) {
		return entry.compiled, nil
	}
	settings, err := provider.repository.Get(ctx, projectID)
	if err != nil {
		return nil, err
	}
	compiled, err := capture.Compile(settings)
	if err != nil {
		return nil, err
	}
	provider.mutex.Lock()
	provider.entries[projectID] = cachedCaptureSettings{compiled: compiled, expiresAt: now.Add(provider.ttl)}
	provider.mutex.Unlock()
	return compiled, nil
}

// applyAPICapture is the authority on which headers reach storage.
//
// A write key is public, so anyone can post an event that carries headers for
// any endpoint. What the browser was told to send is therefore not evidence of
// anything; this function keeps a header only when a project rule names that
// header (or opted the body in) for that method and endpoint, and clears the rest. With no compiled
// rules, which is also what a consumer started without the feature has, every
// header is cleared.
//
// It runs after URL rewriting, so a rule is matched against the same endpoint
// the API monitoring page shows.
func applyAPICapture(events []event.CanonicalEvent, compiled *capture.Compiled) {
	for index := range events {
		candidate := &events[index]
		if len(candidate.APIRequestHeaders) == 0 && len(candidate.APIResponseHeaders) == 0 &&
			candidate.APIRequestBody == "" && candidate.APIResponseBody == "" {
			continue
		}
		if candidate.EventType != event.EventTypeAPI {
			candidate.APIRequestHeaders, candidate.APIResponseHeaders = nil, nil
			candidate.APIRequestBody, candidate.APIResponseBody = "", ""
			continue
		}
		selection := compiled.Select(candidate.APIMethod, candidate.APIURLNormalized)
		candidate.APIRequestHeaders = capture.Restrict(candidate.APIRequestHeaders, selection.Request)
		candidate.APIResponseHeaders = capture.Restrict(candidate.APIResponseHeaders, selection.Response)
		// A body is kept only when the rule opted that direction in, independently of the headers.
		if !selection.RequestBody {
			candidate.APIRequestBody = ""
		}
		if !selection.ResponseBody {
			candidate.APIResponseBody = ""
		}
	}
}
