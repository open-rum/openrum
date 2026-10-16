// Package mailservice decides which SMTP server an instance sends mail with and sends through it.
// Alerts, invitations and the Console's test message all go through Service, so they cannot
// disagree about the configuration.
package mailservice

import (
	"context"
	"errors"
	"time"

	"openrum/internal/mailer"
	"openrum/internal/metadata"
)

var ErrNotConfigured = errors.New("email is not configured")

type Source string

const (
	SourceNone       Source = "none"
	SourceDeployment Source = "deployment"
	SourceManaged    Source = "managed"
)

// ManagedStore reads the Console-managed server. A nil store means managed secrets are off.
type ManagedStore interface {
	GetSMTP(context.Context) (mailer.Settings, metadata.InstanceSecret, error)
}

// Effective is the server mail is sent with right now, and where it came from.
type Effective struct {
	Settings mailer.Settings
	Source   Source
	// Managed is the Console-managed server when one is stored, even if a deployment server
	// overrides it, so the Console can say what a deployment override is hiding.
	Managed   *mailer.Settings
	UpdatedAt time.Time
	Version   int64
}

type Service struct {
	deployment mailer.Settings
	managed    ManagedStore
	sender     mailer.Sender
}

func New(deployment mailer.Settings, managed ManagedStore, sender mailer.Sender) *Service {
	if sender == nil {
		sender = mailer.SMTPSender{}
	}
	return &Service{deployment: deployment, managed: managed, sender: sender}
}

// Effective resolves the configuration. A deployment server always wins: operators who set
// SMTP_* through Helm or Compose expect the Console not to change it underneath them.
func (service *Service) Effective(ctx context.Context) (Effective, error) {
	result := Effective{Source: SourceNone}
	if service.managed != nil {
		settings, secret, err := service.managed.GetSMTP(ctx)
		switch {
		case err == nil:
			result.Managed, result.UpdatedAt, result.Version = &settings, secret.UpdatedAt, secret.Version
		case !errors.Is(err, metadata.ErrNotFound):
			return Effective{}, err
		}
	}
	switch {
	case service.deployment.Configured():
		result.Settings, result.Source = service.deployment, SourceDeployment
	case result.Managed != nil:
		result.Settings, result.Source = *result.Managed, SourceManaged
	}
	return result, nil
}

// Configured reports whether Send would find a server.
func (service *Service) Configured(ctx context.Context) (bool, error) {
	effective, err := service.Effective(ctx)
	return effective.Source != SourceNone, err
}

// Send delivers one message with the effective server, or returns ErrNotConfigured.
func (service *Service) Send(ctx context.Context, message mailer.Message) error {
	effective, err := service.Effective(ctx)
	if err != nil {
		return err
	}
	if effective.Source == SourceNone {
		return ErrNotConfigured
	}
	return service.sender.Send(ctx, effective.Settings, message)
}

// Probe checks candidate settings without sending mail or saving them.
func (service *Service) Probe(ctx context.Context, settings mailer.Settings) error {
	return service.sender.Probe(ctx, settings)
}
