package mailservice

import (
	"context"
	"errors"
	"testing"

	"openrum/internal/mailer"
	"openrum/internal/metadata"
)

type fakeStore struct {
	settings *mailer.Settings
	err      error
}

func (store fakeStore) GetSMTP(context.Context) (mailer.Settings, metadata.InstanceSecret, error) {
	if store.err != nil {
		return mailer.Settings{}, metadata.InstanceSecret{}, store.err
	}
	if store.settings == nil {
		return mailer.Settings{}, metadata.InstanceSecret{}, metadata.ErrNotFound
	}
	return *store.settings, metadata.InstanceSecret{Version: 3}, nil
}

type recordingSender struct {
	used    []mailer.Settings
	message mailer.Message
	err     error
}

func (sender *recordingSender) Send(_ context.Context, settings mailer.Settings, message mailer.Message) error {
	sender.used, sender.message = append(sender.used, settings), message
	return sender.err
}

func (sender *recordingSender) Probe(_ context.Context, settings mailer.Settings) error {
	sender.used = append(sender.used, settings)
	return sender.err
}

var (
	deploymentSettings = mailer.Settings{Host: "deploy.example.com", Port: 587, Security: mailer.SecurityStartTLS, From: "d@example.com"}
	managedSettings    = mailer.Settings{Host: "console.example.com", Port: 465, Security: mailer.SecurityTLS, From: "c@example.com"}
)

func TestNothingConfiguredRefusesToSend(t *testing.T) {
	sender := &recordingSender{}
	service := New(mailer.Settings{}, nil, sender)
	effective, err := service.Effective(context.Background())
	if err != nil || effective.Source != SourceNone {
		t.Fatalf("effective = %+v, %v", effective, err)
	}
	if err := service.Send(context.Background(), mailer.Message{To: []string{"a@example.com"}, Subject: "s", Body: "b"}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("Send error = %v, want ErrNotConfigured", err)
	}
	if len(sender.used) != 0 {
		t.Fatal("nothing should have been sent")
	}
}

func TestManagedServerIsUsedWhenTheDeploymentHasNone(t *testing.T) {
	sender := &recordingSender{}
	service := New(mailer.Settings{}, fakeStore{settings: &managedSettings}, sender)
	effective, err := service.Effective(context.Background())
	if err != nil || effective.Source != SourceManaged || effective.Settings != managedSettings || effective.Version != 3 {
		t.Fatalf("effective = %+v, %v", effective, err)
	}
	if err := service.Send(context.Background(), mailer.Message{To: []string{"a@example.com"}, Subject: "s", Body: "b"}); err != nil {
		t.Fatal(err)
	}
	if len(sender.used) != 1 || sender.used[0] != managedSettings {
		t.Fatalf("used = %+v", sender.used)
	}
}

func TestDeploymentServerWinsAndReportsWhatItHides(t *testing.T) {
	sender := &recordingSender{}
	service := New(deploymentSettings, fakeStore{settings: &managedSettings}, sender)
	effective, err := service.Effective(context.Background())
	if err != nil || effective.Source != SourceDeployment || effective.Settings != deploymentSettings {
		t.Fatalf("effective = %+v, %v", effective, err)
	}
	if effective.Managed == nil || *effective.Managed != managedSettings {
		t.Fatalf("hidden managed server = %+v", effective.Managed)
	}
	if err := service.Send(context.Background(), mailer.Message{To: []string{"a@example.com"}, Subject: "s", Body: "b"}); err != nil {
		t.Fatal(err)
	}
	if sender.used[0] != deploymentSettings {
		t.Fatalf("sent through %+v, want the deployment server", sender.used[0])
	}
}

func TestStoreFailureIsNotMistakenForNoConfiguration(t *testing.T) {
	boom := errors.New("decrypt failed")
	service := New(deploymentSettings, fakeStore{err: boom}, &recordingSender{})
	if _, err := service.Effective(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("error = %v, want the store failure", err)
	}
}
