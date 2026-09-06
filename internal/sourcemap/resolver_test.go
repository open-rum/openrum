package sourcemap

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRegularAndIndexedMaps(t *testing.T) {
	regular := parseFixture(t, "regular.json")
	position, err := regular.Resolve(1, 0)
	if err != nil || position.Source != "src/checkout.ts" || position.Function != "checkout" || position.Line != 1 {
		t.Fatalf("position=%+v err=%v", position, err)
	}
	indexed := parseFixture(t, "indexed.json")
	position, err = indexed.Resolve(2, 0)
	if err != nil || position.Source != "src/second.ts" || position.Function != "second" {
		t.Fatalf("position=%+v err=%v", position, err)
	}
}

func TestParserReturnsFiniteFailures(t *testing.T) {
	tests := []struct {
		contents string
		failure  FailureCode
	}{
		{"not json", FailureInvalidMap},
		{`{"version":3,"sections":[{"offset":{"line":0,"column":0},"url":"external.map"}]}`, FailureUnsupportedIndex},
		{`{"version":3,"sections":[{"offset":{"line":1,"column":0},"map":{"version":3}},{"offset":{"line":0,"column":0},"map":{"version":3}}]}`, FailureInvalidMap},
	}
	for _, test := range tests {
		if _, err := Parse("https://cdn.example/app.js.map", []byte(test.contents)); FailureOf(err) != test.failure {
			t.Fatalf("contents=%s failure=%s err=%v", test.contents, FailureOf(err), err)
		}
	}
}

func TestMatchArtifactIsExactAndDetectsAmbiguity(t *testing.T) {
	candidate := ArtifactCandidate{ID: "one", Release: "web@1", Dist: "browser", ArtifactName: "~/assets/app.js.map"}
	matched, err := MatchArtifact([]ArtifactCandidate{candidate}, "web@1", "browser", "https://cdn.example/assets/app.js?v=1")
	if err != nil || matched.ID != "one" {
		t.Fatalf("matched=%+v err=%v", matched, err)
	}
	if _, err := MatchArtifact([]ArtifactCandidate{candidate}, "web@2", "browser", "https://cdn.example/assets/app.js"); FailureOf(err) != FailureMissingArtifact {
		t.Fatalf("failure=%s err=%v", FailureOf(err), err)
	}
	if _, err := MatchArtifact([]ArtifactCandidate{candidate, candidate}, "web@1", "browser", "https://cdn.example/assets/app.js"); FailureOf(err) != FailureAmbiguous {
		t.Fatalf("failure=%s err=%v", FailureOf(err), err)
	}
}

func parseFixture(t *testing.T, name string) *ParsedMap {
	t.Helper()
	contents, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "sourcemaps", name))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := Parse("https://cdn.example/assets/app.js.map", contents)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
