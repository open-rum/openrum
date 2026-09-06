package sourcemap

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	gosourcemap "github.com/go-sourcemap/sourcemap"
)

const MaxMapBytes = 64 << 20

type FailureCode string

const (
	FailureMissingRelease   FailureCode = "missing_release"
	FailureMissingArtifact  FailureCode = "missing_artifact"
	FailureAmbiguous        FailureCode = "ambiguous_artifact"
	FailureInvalidMap       FailureCode = "invalid_map"
	FailureUnsupportedIndex FailureCode = "unsupported_index_url"
	FailureNoMapping        FailureCode = "no_mapping"
	FailureResourceLimit    FailureCode = "resource_limit"
)

type ResolveError struct {
	Code FailureCode
	Err  error
}

func (err *ResolveError) Error() string {
	if err.Err == nil {
		return string(err.Code)
	}
	return fmt.Sprintf("%s: %v", err.Code, err.Err)
}

func (err *ResolveError) Unwrap() error { return err.Err }

type ParsedMap struct{ consumer *gosourcemap.Consumer }

type mapEnvelope struct {
	Version  int `json:"version"`
	Sections []struct {
		Offset struct {
			Line   int `json:"line"`
			Column int `json:"column"`
		} `json:"offset"`
		URL string          `json:"url"`
		Map json.RawMessage `json:"map"`
	} `json:"sections"`
}

func Parse(mapURL string, contents []byte) (*ParsedMap, error) {
	if len(contents) == 0 {
		return nil, &ResolveError{Code: FailureInvalidMap, Err: errors.New("empty source map")}
	}
	if len(contents) > MaxMapBytes {
		return nil, &ResolveError{Code: FailureResourceLimit, Err: errors.New("source map is too large")}
	}
	var envelope mapEnvelope
	if err := json.Unmarshal(contents, &envelope); err != nil {
		return nil, &ResolveError{Code: FailureInvalidMap, Err: err}
	}
	if envelope.Version != 3 && envelope.Version != 0 {
		return nil, &ResolveError{Code: FailureInvalidMap, Err: fmt.Errorf("unsupported version %d", envelope.Version)}
	}
	lastLine, lastColumn := -1, -1
	for _, section := range envelope.Sections {
		if section.URL != "" {
			return nil, &ResolveError{Code: FailureUnsupportedIndex, Err: errors.New("external indexed sections are not supported")}
		}
		if len(section.Map) == 0 || string(section.Map) == "null" || section.Offset.Line < 0 || section.Offset.Column < 0 ||
			section.Offset.Line < lastLine || (section.Offset.Line == lastLine && section.Offset.Column <= lastColumn) {
			return nil, &ResolveError{Code: FailureInvalidMap, Err: errors.New("invalid or unordered indexed section")}
		}
		lastLine, lastColumn = section.Offset.Line, section.Offset.Column
	}
	consumer, err := gosourcemap.Parse(mapURL, contents)
	if err != nil {
		return nil, &ResolveError{Code: FailureInvalidMap, Err: err}
	}
	return &ParsedMap{consumer: consumer}, nil
}

func FailureOf(err error) FailureCode {
	var resolveError *ResolveError
	if errors.As(err, &resolveError) {
		return resolveError.Code
	}
	return ""
}

func normalizeSourcePath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	for _, prefix := range []string{"webpack://", "webpack:", "file://"} {
		value = strings.TrimPrefix(value, prefix)
	}
	value = strings.TrimLeft(value, "/")
	for strings.HasPrefix(value, "./") || strings.HasPrefix(value, "../") {
		value = strings.TrimPrefix(strings.TrimPrefix(value, "./"), "../")
	}
	return value
}
