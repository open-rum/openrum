package sourcemap

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

const (
	MaxStackBytes  = 256 << 10
	MaxStackFrames = 50
)

var stackFramePattern = regexp.MustCompile(`(?m)^\s*(?:at\s+)?([^\n(]*?)(?:\s*\()?((?:(?:https?|file|webpack)://|/)[^\s)]+):(\d+):(\d+)\)?\s*$`)

type StackFrame struct {
	Function string            `json:"function,omitempty"`
	URL      string            `json:"url"`
	Line     int               `json:"line"`
	Column   int               `json:"column"`
	Original *OriginalPosition `json:"original,omitempty"`
	Failure  FailureCode       `json:"failure,omitempty"`
}

type MappedStack struct {
	Raw     string       `json:"raw"`
	Status  string       `json:"status"`
	Failure FailureCode  `json:"failure,omitempty"`
	Frames  []StackFrame `json:"frames"`
}

// ErrRetryable marks a stack that could not be mapped because a dependency
// (object storage or the artifact catalog) failed. Such results are never
// persisted, so the event is mapped again once the dependency recovers.
var ErrRetryable = errors.New("source map mapping is temporarily unavailable")

func retryable(err error) error {
	return fmt.Errorf("%w: %w", ErrRetryable, err)
}

type Mapper struct {
	artifacts ArtifactLister
	storage   Storage
	cache     *Cache
}

func NewMapper(artifacts ArtifactLister, storage Storage, cache *Cache) *Mapper {
	if cache == nil {
		cache = NewCache(128 << 20)
	}
	return &Mapper{artifacts: artifacts, storage: storage, cache: cache}
}

// MapStack resolves every recognised frame. Content problems become per-frame
// failure codes in the returned stack; an error wrapping ErrRetryable means the
// result is incomplete for transient reasons and must not be saved.
func (mapper *Mapper) MapStack(ctx context.Context, projectID uuid.UUID, release, dist, raw string) (MappedStack, error) {
	result := MappedStack{Raw: raw, Status: "failed", Frames: []StackFrame{}}
	if release == "" {
		result.Failure = FailureMissingRelease
		return result, nil
	}
	if len(raw) == 0 || len(raw) > MaxStackBytes {
		result.Failure = FailureResourceLimit
		return result, nil
	}
	matches := stackFramePattern.FindAllStringSubmatch(raw, MaxStackFrames+1)
	if len(matches) == 0 {
		result.Failure = FailureNoMapping
		return result, nil
	}
	if len(matches) > MaxStackFrames {
		matches = matches[:MaxStackFrames]
		result.Failure = FailureResourceLimit
	}
	ready, err := mapper.artifacts.ReadyArtifacts(ctx, projectID, release, dist)
	if err != nil {
		return MappedStack{Raw: raw, Status: "failed", Frames: []StackFrame{}}, retryable(err)
	}
	artifacts := make(map[string]Artifact, len(ready))
	candidates := make([]ArtifactCandidate, 0, len(ready))
	for _, artifact := range ready {
		key := artifact.ID.String()
		artifacts[key] = artifact
		candidates = append(candidates, ArtifactCandidate{ID: key, Release: artifact.Release, Dist: artifact.Dist, ArtifactName: artifact.ArtifactName})
	}
	// Frames of one stack usually share a bundle; remember per-artifact
	// outcomes, including failures the shared cache does not keep.
	loaded := make(map[string]loadedMap)
	mappedCount := 0
	for _, match := range matches {
		line, _ := strconv.Atoi(match[3])
		column, _ := strconv.Atoi(match[4])
		frame := StackFrame{Function: strings.TrimSpace(match[1]), URL: match[2], Line: line, Column: column}
		candidate, err := MatchArtifact(candidates, release, dist, frame.URL)
		var parsed *ParsedMap
		if err == nil {
			parsed, err = mapper.load(ctx, artifacts[candidate.ID], frame.URL, loaded)
			if errors.Is(err, ErrRetryable) {
				return MappedStack{Raw: raw, Status: "failed", Frames: []StackFrame{}}, err
			}
		}
		var position OriginalPosition
		if err == nil {
			position, err = parsed.Resolve(frame.Line, frame.Column)
		}
		if err != nil {
			frame.Failure = failureOr(err, FailureInvalidMap)
			if result.Failure == "" {
				result.Failure = frame.Failure
			}
		} else {
			frame.Original = &position
			mappedCount++
		}
		result.Frames = append(result.Frames, frame)
	}
	switch {
	case mappedCount == len(result.Frames):
		result.Status, result.Failure = "mapped", ""
	case mappedCount > 0:
		result.Status = "partial"
	default:
		result.Status = "failed"
	}
	return result, nil
}

type loadedMap struct {
	parsed *ParsedMap
	err    error
}

// load returns the parsed map for artifact, consulting the shared cache by
// content digest before touching object storage.
func (mapper *Mapper) load(ctx context.Context, artifact Artifact, generatedURL string, loaded map[string]loadedMap) (*ParsedMap, error) {
	key := ArtifactCacheKey(artifact)
	if previous, ok := loaded[key]; ok {
		return previous.parsed, previous.err
	}
	if parsed, ok := mapper.cache.Get(key); ok {
		loaded[key] = loadedMap{parsed: parsed}
		return parsed, nil
	}
	if mapper.storage == nil {
		return nil, retryable(ErrInvalidStorage)
	}
	contents, err := mapper.storage.Read(ctx, artifact.OSSKey, MaxMapBytes)
	if err != nil {
		switch {
		case FailureOf(err) != "":
		case IsObjectNotFound(err):
			// The catalog says ready but the object is gone; retrying would
			// never succeed, so record it like any other missing artifact.
			err = &ResolveError{Code: FailureMissingArtifact, Err: err}
		default:
			return nil, retryable(err)
		}
		loaded[key] = loadedMap{err: err}
		return nil, err
	}
	var parsed *ParsedMap
	if err = ValidateArtifactBytes(artifact, contents); err == nil {
		parsed, err = mapper.cache.GetOrParse(key, generatedURL+".map", contents)
	}
	loaded[key] = loadedMap{parsed: parsed, err: err}
	return parsed, err
}

func failureOr(err error, fallback FailureCode) FailureCode {
	if failure := FailureOf(err); failure != "" {
		return failure
	}
	return fallback
}
