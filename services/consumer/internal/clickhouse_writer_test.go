package consumerservice

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/google/uuid"

	"openrum/internal/event"
)

type fakeClickHouseConnection struct {
	driver.Conn
	mutex        sync.Mutex
	prepareCalls int
	sendFailures int
	committed    [][][]any
	closed       bool
}

func (connection *fakeClickHouseConnection) PrepareBatch(context.Context, string, ...driver.PrepareBatchOption) (driver.Batch, error) {
	connection.mutex.Lock()
	defer connection.mutex.Unlock()
	connection.prepareCalls++
	return &fakeClickHouseBatch{connection: connection}, nil
}

func (connection *fakeClickHouseConnection) Close() error {
	connection.mutex.Lock()
	defer connection.mutex.Unlock()
	connection.closed = true
	return nil
}

type fakeClickHouseBatch struct {
	driver.Batch
	connection *fakeClickHouseConnection
	rows       [][]any
}

func (batch *fakeClickHouseBatch) Append(values ...any) error {
	batch.rows = append(batch.rows, append([]any(nil), values...))
	return nil
}

func (batch *fakeClickHouseBatch) Send() error {
	batch.connection.mutex.Lock()
	defer batch.connection.mutex.Unlock()
	if batch.connection.sendFailures > 0 {
		batch.connection.sendFailures--
		return errors.New("temporary ClickHouse failure")
	}
	batch.connection.committed = append(batch.connection.committed, batch.rows)
	return nil
}

func (batch *fakeClickHouseBatch) Close() error { return nil }

func TestBufferedClickHouseWriterCoalescesConcurrentRequests(t *testing.T) {
	connection := &fakeClickHouseConnection{}
	writer := NewBufferedClickHouseWriter(context.Background(), connection, ClickHouseWriterOptions{FlushInterval: 20 * time.Millisecond})
	events := []event.CanonicalEvent{canonicalFixture()}
	errorsChannel := make(chan error, 2)
	for range 2 {
		go func() { errorsChannel <- writer.WriteEvents(context.Background(), events) }()
	}
	for range 2 {
		if err := <-errorsChannel; err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	connection.mutex.Lock()
	defer connection.mutex.Unlock()
	if connection.prepareCalls != 1 || len(connection.committed) != 1 || len(connection.committed[0]) != 2 || !connection.closed {
		t.Fatalf("prepare=%d batches=%d rows=%d closed=%v", connection.prepareCalls, len(connection.committed), len(connection.committed[0]), connection.closed)
	}
}

func TestBufferedClickHouseWriterRetriesSameBatchAndReportsDurability(t *testing.T) {
	connection := &fakeClickHouseConnection{sendFailures: 1}
	writer := NewBufferedClickHouseWriter(context.Background(), connection, ClickHouseWriterOptions{
		MaxRows: 1, MaxAttempts: 2, AttemptTimeout: time.Second, FlushInterval: time.Hour,
	})
	if err := writer.WriteEvents(context.Background(), []event.CanonicalEvent{canonicalFixture()}); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	connection.mutex.Lock()
	defer connection.mutex.Unlock()
	if connection.prepareCalls != 2 || len(connection.committed) != 1 || len(connection.committed[0]) != 1 {
		t.Fatalf("prepare=%d committed=%d", connection.prepareCalls, len(connection.committed))
	}
}

func TestBufferedClickHouseWriterRejectsWritesAfterClose(t *testing.T) {
	connection := &fakeClickHouseConnection{}
	writer := NewBufferedClickHouseWriter(context.Background(), connection, DefaultClickHouseWriterOptions())
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteEvents(context.Background(), []event.CanonicalEvent{canonicalFixture()}); !errors.Is(err, ErrClickHouseWriterClosed) {
		t.Fatalf("error=%v", err)
	}
}

func TestEventBatchTokenIsDeterministicAndOrderSensitive(t *testing.T) {
	first := canonicalFixture()
	second := canonicalFixture()
	second.EventID = uuid.New()
	firstToken := eventBatchToken([]event.CanonicalEvent{first, second})
	secondToken := eventBatchToken([]event.CanonicalEvent{first, second})
	if firstToken != secondToken {
		t.Fatal("same event batch produced different tokens")
	}
	if eventBatchToken([]event.CanonicalEvent{first, second}) == eventBatchToken([]event.CanonicalEvent{second, first}) {
		t.Fatal("different ordering produced the same token")
	}
}

func canonicalFixture() event.CanonicalEvent {
	return event.CanonicalEvent{
		ProjectID: uuid.New(), EventID: uuid.New(), EventType: event.EventTypePageView,
		Timestamp: time.Now().UTC(), ReceivedAt: time.Now().UTC(), SessionID: uuid.New(), PageID: uuid.New(),
		Environment: "production", Country: "ZZ", Attributes: map[string]string{}, Measurements: map[string]float64{},
		Breadcrumbs: []string{}, IngestFlags: []string{},
	}
}
