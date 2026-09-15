package consumerservice

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"

	"openrum/internal/event"
	"openrum/internal/processing"
)

// Stage labels on the rewrite counter. They are constants rather than literals
// so the label set cannot drift as call sites are added.
const (
	rewriteStageURL   = "url"
	rewriteStageScrub = "scrub"
)

// ProcessingSettingsProvider supplies the compiled rewrite rules for a project.
type ProcessingSettingsProvider interface {
	Get(context.Context, uuid.UUID) (*processing.Compiled, error)
}

type projectProcessingRepository interface {
	Get(context.Context, uuid.UUID) (processing.Settings, error)
}

type cachedProcessingSettings struct {
	compiled  *processing.Compiled
	expiresAt time.Time
}

// CachedProcessingSettingsProvider caches compiled rules for a short window, so
// that a change made in the Console takes effect within one TTL without every
// message costing a database round trip and a pattern compilation.
type CachedProcessingSettingsProvider struct {
	repository projectProcessingRepository
	ttl        time.Duration
	now        func() time.Time
	mutex      sync.RWMutex
	entries    map[uuid.UUID]cachedProcessingSettings
}

func NewCachedProcessingSettingsProvider(
	repository projectProcessingRepository,
	ttl time.Duration,
) *CachedProcessingSettingsProvider {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &CachedProcessingSettingsProvider{
		repository: repository, ttl: ttl, now: time.Now,
		entries: make(map[uuid.UUID]cachedProcessingSettings),
	}
}

func (provider *CachedProcessingSettingsProvider) Get(
	ctx context.Context,
	projectID uuid.UUID,
) (*processing.Compiled, error) {
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
	compiled, err := processing.Compile(settings)
	if err != nil {
		return nil, err
	}
	provider.mutex.Lock()
	provider.entries[projectID] = cachedProcessingSettings{compiled: compiled, expiresAt: now.Add(provider.ttl)}
	provider.mutex.Unlock()
	return compiled, nil
}

// applyProcessingRules rewrites each event in place.
//
// URL rules run before redaction so that a scrub pattern written against a path
// sees the same address the console will show. The order also means a rule
// cannot be defeated by a redaction marker appearing mid-path.
func applyProcessingRules(
	events []event.CanonicalEvent,
	compiled *processing.Compiled,
	metrics *Metrics,
) {
	if !compiled.Active() {
		return
	}
	for index := range events {
		if applyURLRules(&events[index], compiled.URL) && metrics != nil {
			metrics.observeRewritten(rewriteStageURL)
		}
		if applyScrubRules(&events[index], compiled.Scrub) && metrics != nil {
			metrics.observeRewritten(rewriteStageScrub)
		}
	}
}

// applyURLRules collapses the aggregation addresses of one event.
//
// PageURL is left alone. It is the concrete address a session actually visited
// and is what a support conversation is anchored on; the normalized copy exists
// precisely so that collapsing does not have to destroy it.
func applyURLRules(candidate *event.CanonicalEvent, rules *processing.CompiledURLRules) bool {
	if !rules.Active() {
		return false
	}
	changed := false
	if rewritten, matched := rules.ApplyToURL(processing.TargetPage, candidate.PageURLNormalized); matched {
		candidate.PageURLNormalized = rewritten
		changed = true
	}
	// The route is rewritten with the page rules and by the same template, so
	// the route ranking and the page ranking cannot disagree about how one
	// path is spelled.
	if rewritten, matched := rules.ApplyToPath(processing.TargetPage, candidate.Route); matched {
		candidate.Route = rewritten
		changed = true
	}
	if rewritten, matched := rules.ApplyToURL(processing.TargetAPI, candidate.APIURLNormalized); matched {
		candidate.APIURLNormalized = rewritten
		changed = true
	}
	return changed
}

// applyScrubRules redacts the free-text fields of one event with the project's
// own patterns, on top of what internal/privacy already removed.
//
// The fields covered are the ones that carry text a page controls. Identifiers
// such as the user id are not re-scrubbed: they have already been dropped
// entirely if they matched anything, and a partial redaction there would turn
// one user into an unbounded number of distinct users.
func applyScrubRules(candidate *event.CanonicalEvent, rules *processing.CompiledScrubRules) bool {
	changed := false
	scrub := func(target *string) {
		if scrubbed, valueChanged := rules.String(*target); valueChanged {
			*target = scrubbed
			changed = true
		}
	}
	if rules.Active() {
		scrub(&candidate.Title)
		scrub(&candidate.ErrorType)
		scrub(&candidate.ErrorMessage)
		scrub(&candidate.ErrorStack)
		scrub(&candidate.ErrorMechanism)
		scrub(&candidate.CustomName)
		scrub(&candidate.LogMessage)
		scrub(&candidate.LogLogger)
		// URLs keep their query string stripped at normalization, so what is
		// left is a path. A token embedded in a path is exactly the case a
		// project-level pattern is written for.
		scrub(&candidate.PageURL)
		scrub(&candidate.PageURLNormalized)
		scrub(&candidate.APIURLNormalized)
		if attributes, attributesChanged := rules.Attributes(candidate.Attributes); attributesChanged {
			candidate.Attributes = attributes
			changed = true
		}
		if breadcrumbs, breadcrumbsChanged := scrubBreadcrumbs(candidate.Breadcrumbs, rules); breadcrumbsChanged {
			candidate.Breadcrumbs = breadcrumbs
			changed = true
		}
	}
	if changed {
		candidate.IngestFlags = appendIngestFlag(candidate.IngestFlags, "pii_scrubbed")
	}
	return changed
}

// scrubBreadcrumbs decodes each breadcrumb before redacting it rather than
// running the patterns over the stored JSON. A pattern applied to the encoded
// form could match across a field boundary and replace the punctuation that
// holds the document together, leaving a row the console cannot render.
func scrubBreadcrumbs(encoded []string, rules *processing.CompiledScrubRules) ([]string, bool) {
	changed := false
	result := make([]string, 0, len(encoded))
	for _, current := range encoded {
		var breadcrumb event.Breadcrumb
		if err := json.Unmarshal([]byte(current), &breadcrumb); err != nil {
			// Written by the previous stage, so this cannot normally fail.
			// Keeping the original is the safe reading of "cannot normally":
			// dropping it would lose context over a decoding quirk.
			result = append(result, current)
			continue
		}
		breadcrumbChanged := false
		for _, target := range []*string{&breadcrumb.Category, &breadcrumb.Message} {
			if scrubbed, valueChanged := rules.String(*target); valueChanged {
				*target = scrubbed
				breadcrumbChanged = true
			}
		}
		if data, dataChanged := rules.Attributes(breadcrumb.Data); dataChanged {
			breadcrumb.Data = data
			breadcrumbChanged = true
		}
		if !breadcrumbChanged {
			result = append(result, current)
			continue
		}
		reencoded, err := json.Marshal(breadcrumb)
		if err != nil {
			result = append(result, current)
			continue
		}
		result = append(result, string(reencoded))
		changed = true
	}
	return result, changed
}

func appendIngestFlag(flags []string, value string) []string {
	for _, current := range flags {
		if current == value {
			return flags
		}
	}
	return append(flags, value)
}
