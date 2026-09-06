//go:build integration

package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestInstanceSettingRepositoryRejectsConcurrentStaleUpdates(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	actorID := uuid.New()
	key := "concurrent-" + actorID.String()
	mustExecDatabase(t, ctx, database,
		"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,'Config Owner','hash')",
		actorID, "config-"+actorID.String()+"@example.com")
	defer func() {
		_, _ = database.ExecContext(context.WithoutCancel(ctx), "DELETE FROM users WHERE id=$1", actorID)
	}()

	repository := NewInstanceSettingRepository(database)
	created, err := repository.Set(ctx, actorID, "test", key, json.RawMessage("1"), 0)
	if err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	errorsChannel := make(chan error, 2)
	var wait sync.WaitGroup
	for _, value := range []string{"2", "3"} {
		wait.Add(1)
		go func(value string) {
			defer wait.Done()
			<-start
			_, updateErr := repository.Set(ctx, actorID, "test", key, json.RawMessage(value), created.Version)
			errorsChannel <- updateErr
		}(value)
	}
	close(start)
	wait.Wait()
	close(errorsChannel)

	var succeeded, conflicted int
	for updateErr := range errorsChannel {
		switch {
		case updateErr == nil:
			succeeded++
		case errors.Is(updateErr, ErrConfigVersionConflict):
			conflicted++
		default:
			t.Fatalf("unexpected update error: %v", updateErr)
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("concurrent results succeeded=%d conflicted=%d", succeeded, conflicted)
	}
}
