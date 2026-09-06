package sourcemap

import (
	"fmt"
	"strings"
)

type OriginalPosition struct {
	Source        string `json:"source"`
	Function      string `json:"function,omitempty"`
	Line          int    `json:"line"`
	Column        int    `json:"column"`
	SourceContent string `json:"sourceContent,omitempty"`
}

func (parsed *ParsedMap) Resolve(line, column int) (position OriginalPosition, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			position = OriginalPosition{}
			err = &ResolveError{Code: FailureInvalidMap, Err: fmt.Errorf("source map resolver rejected malformed mappings")}
		}
	}()
	if parsed == nil || parsed.consumer == nil || line < 1 || column < 0 {
		return OriginalPosition{}, &ResolveError{Code: FailureNoMapping}
	}
	source, function, originalLine, originalColumn, ok := parsed.consumer.Source(line, column)
	if !ok || source == "" {
		return OriginalPosition{}, &ResolveError{Code: FailureNoMapping}
	}
	return OriginalPosition{
		Source: normalizeSourcePath(source), Function: function, Line: originalLine, Column: originalColumn,
		SourceContent: parsed.consumer.SourceContent(source),
	}, nil
}

type ArtifactCandidate struct {
	ID           string
	Release      string
	Dist         string
	ArtifactName string
}

func MatchArtifact(candidates []ArtifactCandidate, release, dist, generatedURL string) (ArtifactCandidate, error) {
	if strings.TrimSpace(release) == "" {
		return ArtifactCandidate{}, &ResolveError{Code: FailureMissingRelease}
	}
	target := generatedArtifactName(generatedURL)
	matches := make([]ArtifactCandidate, 0, 1)
	for _, candidate := range candidates {
		if candidate.Release == release && candidate.Dist == dist && normalizeArtifactName(candidate.ArtifactName) == target {
			matches = append(matches, candidate)
		}
	}
	if len(matches) == 0 {
		return ArtifactCandidate{}, &ResolveError{Code: FailureMissingArtifact}
	}
	if len(matches) > 1 {
		return ArtifactCandidate{}, &ResolveError{Code: FailureAmbiguous}
	}
	return matches[0], nil
}

func generatedArtifactName(value string) string {
	value = strings.SplitN(value, "#", 2)[0]
	value = strings.SplitN(value, "?", 2)[0]
	if scheme := strings.Index(value, "://"); scheme >= 0 {
		rest := value[scheme+3:]
		if slash := strings.IndexByte(rest, '/'); slash >= 0 {
			value = rest[slash:]
		} else {
			value = ""
		}
	}
	return normalizeArtifactName(value + ".map")
}

func normalizeArtifactName(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	value = strings.TrimPrefix(value, "~")
	return strings.TrimLeft(value, "/")
}
