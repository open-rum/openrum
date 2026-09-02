package event

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type fixtureCase struct {
	File  string `json:"file"`
	Valid bool   `json:"valid"`
}

func TestProtocolFixtures(t *testing.T) {
	fixturesDirectory := protocolFixturesDirectory(t)
	casesData, err := os.ReadFile(filepath.Join(fixturesDirectory, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []fixtureCase
	if err := json.Unmarshal(casesData, &cases); err != nil {
		t.Fatal(err)
	}

	for _, fixture := range cases {
		t.Run(fixture.File, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(fixturesDirectory, fixture.File))
			if err != nil {
				t.Fatal(err)
			}
			validationErr := ValidateEnvelopeV1(data)
			if (validationErr == nil) != fixture.Valid {
				t.Fatalf("valid = %v, want %v; error = %v", validationErr == nil, fixture.Valid, validationErr)
			}
			if fixture.Valid {
				envelope, err := DecodeEnvelopeV1(data)
				if err != nil {
					t.Fatal(err)
				}
				if len(envelope.Events) != 5 {
					t.Fatalf("event count = %d, want 5", len(envelope.Events))
				}
			}
		})
	}
}

func protocolFixturesDirectory(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "packages", "protocol", "fixtures"))
}
