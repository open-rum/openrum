package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"openrum/internal/config"
)

func TestRunStartsAndShutsDown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	stopped := make(chan time.Duration, 1)
	configuration := config.Config{
		Service:         config.ServiceAPI,
		AppEnv:          "test",
		ListenAddress:   ":0",
		ShutdownTimeout: 250 * time.Millisecond,
	}

	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, configuration, Hooks{
			Start: func(context.Context, config.Config) error {
				close(started)
				return nil
			},
			Shutdown: func(shutdownCtx context.Context) error {
				deadline, ok := shutdownCtx.Deadline()
				if !ok {
					stopped <- -1
					return nil
				}
				stopped <- time.Until(deadline)
				return nil
			},
		})
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("service did not start")
	}
	cancel()

	select {
	case remaining := <-stopped:
		if remaining <= 0 || remaining > configuration.ShutdownTimeout {
			t.Fatalf("shutdown deadline remaining = %s", remaining)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown hook was not called")
	}

	if err := <-done; err != nil {
		t.Fatalf("Run() error = %v", err)
	}
}

func TestRunReturnsRuntimeErrorAndStillShutsDown(t *testing.T) {
	runtimeErrors := make(chan error, 1)
	runtimeErrors <- errors.New("listener failed")
	shutdownCalled := false
	err := Run(context.Background(), config.Config{
		Service:         config.ServiceAPI,
		AppEnv:          "test",
		ListenAddress:   ":0",
		ShutdownTimeout: time.Second,
	}, Hooks{
		Errors: runtimeErrors,
		Shutdown: func(context.Context) error {
			shutdownCalled = true
			return nil
		},
	})
	if err == nil || !strings.Contains(err.Error(), "listener failed") {
		t.Fatalf("Run() error = %v", err)
	}
	if !shutdownCalled {
		t.Fatal("shutdown hook was not called")
	}
}
