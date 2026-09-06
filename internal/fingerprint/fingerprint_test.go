package fingerprint

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type corpusEntry struct {
	Name, Group, ErrorType, Message, Stack string
}

func TestFingerprintCorpusStabilityAndCollisionReview(t *testing.T) {
	entries := loadCorpus(t)
	groups := make(map[string]string)
	values := make(map[string]string)
	for _, entry := range entries {
		result, err := Compute(Input{ErrorType: entry.ErrorType, Message: entry.Message, Stack: entry.Stack})
		if err != nil {
			t.Fatalf("%s: %v", entry.Name, err)
		}
		if result.Version != 1 || len(result.Value) != len("v1:")+64 {
			t.Fatalf("%s: result=%+v", entry.Name, result)
		}
		if previous, ok := groups[entry.Group]; ok && previous != result.Value {
			t.Fatalf("group %q is unstable: %s != %s", entry.Group, previous, result.Value)
		}
		groups[entry.Group] = result.Value
		if previousGroup, collision := values[result.Value]; collision && previousGroup != entry.Group {
			t.Fatalf("collision between %q and %q", previousGroup, entry.Group)
		}
		values[result.Value] = entry.Group
	}
	if len(groups) != 3 || len(values) != 3 {
		t.Fatalf("groups=%d fingerprints=%d", len(groups), len(values))
	}
}

func TestCustomFingerprintIsBoundedAndDeterministic(t *testing.T) {
	first, err := Compute(Input{Custom: []string{"checkout", "payment"}})
	if err != nil || !first.Custom {
		t.Fatalf("result=%+v err=%v", first, err)
	}
	second, _ := Compute(Input{Custom: []string{"checkout", "payment"}})
	if first != second {
		t.Fatalf("first=%+v second=%+v", first, second)
	}
	if _, err := Compute(Input{Custom: []string{"line\nbreak"}}); err != ErrInvalidCustomFingerprint {
		t.Fatalf("err=%v", err)
	}
}

func loadCorpus(t *testing.T) []corpusEntry {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve fixture path")
	}
	path := filepath.Join(filepath.Dir(filename), "..", "..", "tests", "fixtures", "fingerprints", "corpus.json")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var entries []corpusEntry
	if err := json.Unmarshal(contents, &entries); err != nil {
		t.Fatal(err)
	}
	return entries
}
