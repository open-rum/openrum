package sourcemap

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

type fakeArtifacts struct {
	artifacts []Artifact
	err       error
	calls     int
}

func (finder *fakeArtifacts) ReadyArtifacts(context.Context, uuid.UUID, string, string) ([]Artifact, error) {
	finder.calls++
	return finder.artifacts, finder.err
}

type memoryStorage struct {
	contents []byte
	err      error
	reads    int
}

func (storage *memoryStorage) PresignUpload(context.Context, string, int64, []byte, time.Duration) (UploadGrant, error) {
	return UploadGrant{}, errors.New("not used")
}
func (storage *memoryStorage) Head(context.Context, string) (ObjectInfo, error) {
	return ObjectInfo{}, errors.New("not used")
}
func (storage *memoryStorage) Delete(context.Context, string) error { return errors.New("not used") }
func (storage *memoryStorage) Read(context.Context, string, int64) ([]byte, error) {
	storage.reads++
	return storage.contents, storage.err
}

type statusError struct{ status int }

func (err statusError) Error() string       { return fmt.Sprintf("status %d", err.status) }
func (err statusError) HttpStatusCode() int { return err.status }

var validMap = []byte(`{"version":3,"sourceRoot":"webpack:///","sources":["src/app.ts"],"sourcesContent":["run()"],"names":["run"],"mappings":"AAAAA"}`)

func readyArtifact(contents []byte, name string) Artifact {
	digest := sha256.Sum256(contents)
	return Artifact{ID: uuid.New(), Release: "web@1", ArtifactName: name, OSSKey: "map", SHA256: digest[:], SizeBytes: int64(len(contents))}
}

func TestMapperMapsStackAndKeepsRaw(t *testing.T) {
	artifacts := &fakeArtifacts{artifacts: []Artifact{readyArtifact(validMap, "assets/app.js.map")}}
	mapper := NewMapper(artifacts, &memoryStorage{contents: validMap}, nil)
	raw := "Error: boom\n    at run (https://cdn.example/assets/app.js:1:0)"
	result, err := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", raw)
	if err != nil || result.Raw != raw || result.Status != "mapped" || len(result.Frames) != 1 || result.Frames[0].Original.Source != "src/app.ts" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestMapperIsolatesCorruptMapAndBoundsInput(t *testing.T) {
	contents := []byte(`{"version":3,"mappings":"!"}`)
	artifacts := &fakeArtifacts{artifacts: []Artifact{readyArtifact(contents, "assets/app.js.map")}}
	mapper := NewMapper(artifacts, &memoryStorage{contents: contents}, nil)
	result, err := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", "at run (https://cdn.example/assets/app.js:1:0)")
	if err != nil || result.Status != "failed" || result.Failure != FailureInvalidMap || result.Raw == "" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	tooLarge, err := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", string(make([]byte, MaxStackBytes+1)))
	if err != nil || tooLarge.Failure != FailureResourceLimit {
		t.Fatalf("result=%+v err=%v", tooLarge, err)
	}
}

func TestMapperQueriesCatalogOncePerStackAndSkipsDownloadOnCacheHit(t *testing.T) {
	artifacts := &fakeArtifacts{artifacts: []Artifact{readyArtifact(validMap, "assets/app.js.map")}}
	storage := &memoryStorage{contents: validMap}
	mapper := NewMapper(artifacts, storage, nil)
	raw := "at run (https://cdn.example/assets/app.js:1:0)\nat run (https://cdn.example/assets/app.js:1:0)\nat other (https://cdn.example/assets/other.js:1:0)"
	first, err := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", raw)
	if err != nil || first.Status != "partial" || artifacts.calls != 1 || storage.reads != 1 || first.Frames[2].Failure != FailureMissingArtifact {
		t.Fatalf("result=%+v catalog=%d reads=%d err=%v", first, artifacts.calls, storage.reads, err)
	}
	second, err := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", raw)
	if err != nil || second.Status != "partial" || artifacts.calls != 2 || storage.reads != 1 {
		t.Fatalf("result=%+v catalog=%d reads=%d err=%v", second, artifacts.calls, storage.reads, err)
	}
}

func TestMapperReportsTransientFailuresAsRetryable(t *testing.T) {
	raw := "at run (https://cdn.example/assets/app.js:1:0)"
	artifact := readyArtifact(validMap, "assets/app.js.map")
	for name, mapper := range map[string]*Mapper{
		"storage": NewMapper(&fakeArtifacts{artifacts: []Artifact{artifact}}, &memoryStorage{err: errors.New("connection reset")}, nil),
		"denied":  NewMapper(&fakeArtifacts{artifacts: []Artifact{artifact}}, &memoryStorage{err: statusError{status: 403}}, nil),
		"catalog": NewMapper(&fakeArtifacts{err: errors.New("database is down")}, &memoryStorage{contents: validMap}, nil),
		"absent":  NewMapper(&fakeArtifacts{artifacts: []Artifact{artifact}}, nil, nil),
	} {
		if _, err := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", raw); !errors.Is(err, ErrRetryable) {
			t.Fatalf("%s: err=%v", name, err)
		}
	}
}

func TestMapperRecordsDeletedObjectAsMissingArtifact(t *testing.T) {
	artifacts := &fakeArtifacts{artifacts: []Artifact{readyArtifact(validMap, "assets/app.js.map")}}
	mapper := NewMapper(artifacts, &memoryStorage{err: statusError{status: 404}}, nil)
	result, err := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", "at run (https://cdn.example/assets/app.js:1:0)")
	if err != nil || result.Status != "failed" || result.Failure != FailureMissingArtifact {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}
