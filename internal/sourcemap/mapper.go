package sourcemap

import (
	"context"
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

type Mapper struct {
	artifacts ArtifactFinder
	storage   Storage
	cache     *Cache
}

func NewMapper(artifacts ArtifactFinder, storage Storage, cache *Cache) *Mapper {
	if cache == nil {
		cache = NewCache(128 << 20)
	}
	return &Mapper{artifacts: artifacts, storage: storage, cache: cache}
}

func (mapper *Mapper) MapStack(ctx context.Context, projectID uuid.UUID, release, dist, raw string) MappedStack {
	result := MappedStack{Raw: raw, Status: "failed", Frames: []StackFrame{}}
	if release == "" {
		result.Failure = FailureMissingRelease
		return result
	}
	if len(raw) == 0 || len(raw) > MaxStackBytes {
		result.Failure = FailureResourceLimit
		return result
	}
	matches := stackFramePattern.FindAllStringSubmatch(raw, MaxStackFrames+1)
	if len(matches) == 0 {
		result.Failure = FailureNoMapping
		return result
	}
	if len(matches) > MaxStackFrames {
		matches = matches[:MaxStackFrames]
		result.Failure = FailureResourceLimit
	}
	mappedCount := 0
	for _, match := range matches {
		line, _ := strconv.Atoi(match[3])
		column, _ := strconv.Atoi(match[4])
		frame := StackFrame{Function: strings.TrimSpace(match[1]), URL: match[2], Line: line, Column: column}
		artifact, err := mapper.artifacts.Find(ctx, projectID, release, dist, frame.URL)
		if err != nil {
			frame.Failure = failureOr(err, FailureMissingArtifact)
			result.Frames = append(result.Frames, frame)
			if result.Failure == "" {
				result.Failure = frame.Failure
			}
			continue
		}
		contents, err := mapper.storage.Read(ctx, artifact.OSSKey, MaxMapBytes)
		if err == nil {
			err = ValidateArtifactBytes(artifact, contents)
		}
		var parsed *ParsedMap
		if err == nil {
			parsed, err = mapper.cache.GetOrParse(ArtifactCacheKey(artifact), frame.URL+".map", contents)
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
	return result
}

func failureOr(err error, fallback FailureCode) FailureCode {
	if failure := FailureOf(err); failure != "" {
		return failure
	}
	return fallback
}
