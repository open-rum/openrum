package internal

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/notify"
)

type recordedDelivery struct {
	channelID uuid.UUID
	failed    bool
	code      string
}

type fixtureDeliveryStore struct {
	targets    []DeliveryTarget
	evaluation uuid.UUID
	mutex      sync.Mutex
	recorded   []recordedDelivery
}

func (store *fixtureDeliveryStore) DeliveryTargets(context.Context, uuid.UUID) ([]DeliveryTarget, error) {
	return store.targets, nil
}
func (store *fixtureDeliveryStore) EvaluationID(context.Context, uuid.UUID, AlertWindow) (uuid.UUID, error) {
	return store.evaluation, nil
}
func (*fixtureDeliveryStore) ProjectName(context.Context, uuid.UUID) (string, error) {
	return "Web", nil
}
func (store *fixtureDeliveryStore) RecordDelivery(_ context.Context, _, _, channelID uuid.UUID, sendErr error, code string) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.recorded = append(store.recorded, recordedDelivery{channelID: channelID, failed: sendErr != nil, code: code})
	return nil
}

// plainOpener "decrypts" by checking the AAD binds the config to its channel.
type plainOpener struct{}

func (plainOpener) Open(encoded, additionalData []byte) ([]byte, string, error) {
	var sealed struct {
		AAD    string          `json:"aad"`
		Config json.RawMessage `json:"config"`
	}
	if err := json.Unmarshal(encoded, &sealed); err != nil || sealed.AAD != string(additionalData) {
		return nil, "", errors.New("authentication failed")
	}
	return sealed.Config, "k1", nil
}

func sealFor(channelID uuid.UUID, config map[string]string) []byte {
	raw, _ := json.Marshal(config)
	sealed, _ := json.Marshal(map[string]any{"aad": string(metadata.ChannelAAD(channelID)), "config": json.RawMessage(raw)})
	return sealed
}

type capturingNotifier struct {
	fail error
	got  *[]notify.Notification
}

func (notifier capturingNotifier) Send(_ context.Context, notification notify.Notification) error {
	*notifier.got = append(*notifier.got, notification)
	return notifier.fail
}

func dispatchFixture() (metadata.AlertRule, AlertWindow) {
	rule := metadata.AlertRule{
		ID: uuid.New(), ProjectID: uuid.New(), Name: "错误率过高", Metric: metadata.AlertErrorRate, Comparator: "gte",
		Threshold: 2, WindowMinutes: 5, Environment: "production",
	}
	end := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	return rule, AlertWindow{StartedAt: end.Add(-5 * time.Minute), EndedAt: end}
}

func TestDispatcherSendsToEachChannelAndLogsEveryOutcome(t *testing.T) {
	good, bad := uuid.New(), uuid.New()
	store := &fixtureDeliveryStore{evaluation: uuid.New(), targets: []DeliveryTarget{
		{ChannelID: good, Kind: "feishu", EncryptedConfig: sealFor(good, map[string]string{"webhookUrl": "ok"})},
		{ChannelID: bad, Kind: "feishu", EncryptedConfig: sealFor(bad, map[string]string{"webhookUrl": "bad"})},
	}}
	base, _ := url.Parse("https://rum.example.com/")
	dispatcher := NewChannelDispatcher(store, plainOpener{}, base, nil)
	var sent []notify.Notification
	dispatcher.build = func(_ string, config map[string]string, _ notify.IPResolver) (notify.Notifier, error) {
		if config["webhookUrl"] == "bad" {
			return capturingNotifier{got: &sent, fail: &notify.DeliveryError{Code: "feishu_sign_invalid", Err: errors.New("sign")}}, nil
		}
		return capturingNotifier{got: &sent}, nil
	}
	rule, window := dispatchFixture()
	if err := dispatcher.Dispatch(context.Background(), rule, window, 3.5); err != nil {
		t.Fatalf("one accepting channel is a delivered alert: %v", err)
	}
	if len(store.recorded) != 2 || store.recorded[0].failed || !store.recorded[1].failed || store.recorded[1].code != "feishu_sign_invalid" {
		t.Fatalf("deliveries: %+v", store.recorded)
	}
	alert := sent[0]
	if alert.Kind != notify.NotificationAlert || alert.Alert.ProjectName != "Web" || alert.Alert.Unit != "percent" ||
		!strings.HasPrefix(alert.DeepLink, "https://rum.example.com/projects/"+rule.ProjectID.String()+"/issues?") ||
		!strings.Contains(alert.DeepLink, "environment=production") {
		t.Fatalf("notification: %+v", alert)
	}
}

func TestDispatcherFailsWhenNoChannelAccepts(t *testing.T) {
	channel := uuid.New()
	store := &fixtureDeliveryStore{evaluation: uuid.New(), targets: []DeliveryTarget{
		{ChannelID: channel, Kind: "feishu", EncryptedConfig: sealFor(uuid.New(), map[string]string{})},
	}}
	dispatcher := NewChannelDispatcher(store, plainOpener{}, nil, nil)
	rule, window := dispatchFixture()
	if err := dispatcher.Dispatch(context.Background(), rule, window, 3); err == nil {
		t.Fatal("a config sealed for another channel must not decrypt, so nothing is delivered")
	}
	if len(store.recorded) != 1 || store.recorded[0].code != "decrypt_failed" {
		t.Fatalf("deliveries: %+v", store.recorded)
	}
}

func TestDispatcherWithoutSecretsLogsOnceAndRecordsWhy(t *testing.T) {
	channel := uuid.New()
	store := &fixtureDeliveryStore{evaluation: uuid.New(), targets: []DeliveryTarget{{ChannelID: channel, Kind: "feishu"}}}
	warnings := 0
	dispatcher := NewChannelDispatcher(store, nil, nil, func(string) { warnings++ })
	rule, window := dispatchFixture()
	for range 2 {
		if err := dispatcher.Dispatch(context.Background(), rule, window, 3); err == nil {
			t.Fatal("without a master key no channel can be reached")
		}
	}
	if warnings != 1 || store.recorded[0].code != "secrets_unavailable" {
		t.Fatalf("warnings=%d deliveries=%+v", warnings, store.recorded)
	}
}

func TestDispatcherTreatsARuleWithoutChannelsAsHandled(t *testing.T) {
	store := &fixtureDeliveryStore{}
	dispatcher := NewChannelDispatcher(store, plainOpener{}, nil, nil)
	rule, window := dispatchFixture()
	if err := dispatcher.Dispatch(context.Background(), rule, window, 3); err != nil || len(store.recorded) != 0 {
		t.Fatalf("err=%v deliveries=%+v", err, store.recorded)
	}
}
