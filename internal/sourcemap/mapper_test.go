package sourcemap

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type fakeArtifacts struct{ artifact Artifact }

func (finder fakeArtifacts) Find(context.Context, uuid.UUID, string, string, string) (Artifact, error) {
	if finder.artifact.ID == uuid.Nil {
		return Artifact{}, &ResolveError{Code: FailureMissingArtifact}
	}
	return finder.artifact, nil
}

type memoryStorage struct {
	contents []byte
	err      error
}

func (storage memoryStorage) PresignUpload(context.Context, string, int64, []byte, time.Duration) (UploadGrant, error) {
	return UploadGrant{}, errors.New("not used")
}
func (storage memoryStorage) Head(context.Context, string) (ObjectInfo, error) {
	return ObjectInfo{}, errors.New("not used")
}
func (storage memoryStorage) Delete(context.Context, string) error { return errors.New("not used") }
func (storage memoryStorage) Read(context.Context, string, int64) ([]byte, error) {
	return storage.contents, storage.err
}

func TestMapperMapsStackAndKeepsRaw(t *testing.T) {
	contents := []byte(`{"version":3,"sourceRoot":"webpack:///","sources":["src/app.ts"],"sourcesContent":["run()"],"names":["run"],"mappings":"AAAAA"}`)
	digest := sha256.Sum256(contents)
	artifact := Artifact{ID: uuid.New(), OSSKey: "map", SHA256: digest[:], SizeBytes: int64(len(contents))}
	mapper := NewMapper(fakeArtifacts{artifact: artifact}, memoryStorage{contents: contents}, nil)
	raw := "Error: boom\n    at run (https://cdn.example/assets/app.js:1:0)"
	result := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", raw)
	if result.Raw != raw || result.Status != "mapped" || len(result.Frames) != 1 || result.Frames[0].Original.Source != "src/app.ts" {
		t.Fatalf("result=%+v", result)
	}
}

func TestMapperIsolatesCorruptMapAndBoundsInput(t *testing.T) {
	contents := []byte(`{"version":3,"mappings":"!"}`)
	digest := sha256.Sum256(contents)
	artifact := Artifact{ID: uuid.New(), OSSKey: "map", SHA256: digest[:], SizeBytes: int64(len(contents))}
	mapper := NewMapper(fakeArtifacts{artifact: artifact}, memoryStorage{contents: contents}, nil)
	result := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", "at run (https://cdn.example/assets/app.js:1:0)")
	if result.Status != "failed" || result.Failure != FailureInvalidMap || result.Raw == "" {
		t.Fatalf("result=%+v", result)
	}
	tooLarge := mapper.MapStack(t.Context(), uuid.New(), "web@1", "", string(make([]byte, MaxStackBytes+1)))
	if tooLarge.Failure != FailureResourceLimit {
		t.Fatalf("result=%+v", tooLarge)
	}
}
