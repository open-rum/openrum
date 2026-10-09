package catalog

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"testing"
)

var update = flag.Bool("update", false, "rewrite testdata/catalog.golden.json")

// The golden file is what the Console's catalog schema is tested against. A change here
// is a change to a published contract: regenerate with `go test ./internal/catalog -update`
// and review the diff.
func TestCatalogDocumentMatchesGolden(t *testing.T) {
	encoded, err := json.MarshalIndent(Describe(), "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	if *update {
		if err := os.WriteFile("testdata/catalog.golden.json", encoded, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	golden, err := os.ReadFile("testdata/catalog.golden.json")
	if err != nil {
		t.Fatalf("missing golden file (run with -update): %v", err)
	}
	if !bytes.Equal(golden, encoded) {
		t.Fatal("the catalog document changed; rerun with -update and review the diff")
	}
}
