package consumerservice

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"openrum/internal/event"
)

const insertEventsQuery = `INSERT INTO rum_events (
project_id,event_id,event_type,timestamp,received_at,environment,release,dist,session_id,anonymous_user_id,user_id,page_id,
page_url,page_url_normalized,route,referrer,title,navigation_type,sdk_name,sdk_version,schema_version,sample_rate,
browser,browser_version,os,os_version,device_type,country,trace_id,span_id,error_type,error_message,error_stack,
error_mechanism,fingerprint,handled,api_method,api_url_normalized,api_status,api_failure,duration_ms,transfer_size,
metric_name,metric_value,metric_delta,metric_rating,custom_name,attributes,measurements,breadcrumbs,ingest_flags
)`

var ErrClickHouseWriterClosed = errors.New("ClickHouse writer is closed")

type ClickHouseWriterOptions struct {
	MaxRows        int
	MaxBytes       int
	FlushInterval  time.Duration
	MaxAttempts    int
	AttemptTimeout time.Duration
	Observer       ClickHouseBatchObserver
}

type ClickHouseBatchObserver interface {
	ObserveClickHouseBatch(rows int, duration time.Duration, err error)
}

func DefaultClickHouseWriterOptions() ClickHouseWriterOptions {
	return ClickHouseWriterOptions{
		MaxRows: 1_000, MaxBytes: 4 * 1024 * 1024, FlushInterval: 10 * time.Millisecond,
		MaxAttempts: 3, AttemptTimeout: 2 * time.Second,
	}
}

type writerCommand struct {
	request *writeRequest
	close   chan error
}

type writeRequest struct {
	events []event.CanonicalEvent
	bytes  int
	result chan error
}

type BufferedClickHouseWriter struct {
	connection driver.Conn
	options    ClickHouseWriterOptions
	commands   chan writerCommand
	closed     atomic.Bool
	enqueue    sync.Mutex
	done       chan struct{}
}

func OpenBufferedClickHouseWriter(ctx context.Context, dsn string, options ClickHouseWriterOptions) (*BufferedClickHouseWriter, error) {
	connectionOptions, err := clickhouse.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse ClickHouse DSN: %w", err)
	}
	connectionOptions.Compression = &clickhouse.Compression{Method: clickhouse.CompressionLZ4}
	connectionOptions.MaxOpenConns = 8
	connectionOptions.MaxIdleConns = 4
	connectionOptions.ConnMaxLifetime = 30 * time.Minute
	connection, err := clickhouse.Open(connectionOptions)
	if err != nil {
		return nil, fmt.Errorf("open ClickHouse: %w", err)
	}
	if err := connection.Ping(ctx); err != nil {
		_ = connection.Close()
		return nil, fmt.Errorf("ping ClickHouse: %w", err)
	}
	return NewBufferedClickHouseWriter(ctx, connection, options), nil
}

func NewBufferedClickHouseWriter(ctx context.Context, connection driver.Conn, options ClickHouseWriterOptions) *BufferedClickHouseWriter {
	defaults := DefaultClickHouseWriterOptions()
	if options.MaxRows <= 0 {
		options.MaxRows = defaults.MaxRows
	}
	if options.MaxBytes <= 0 {
		options.MaxBytes = defaults.MaxBytes
	}
	if options.FlushInterval <= 0 {
		options.FlushInterval = defaults.FlushInterval
	}
	if options.MaxAttempts <= 0 {
		options.MaxAttempts = defaults.MaxAttempts
	}
	if options.AttemptTimeout <= 0 {
		options.AttemptTimeout = defaults.AttemptTimeout
	}
	writer := &BufferedClickHouseWriter{
		connection: connection, options: options, commands: make(chan writerCommand, 256), done: make(chan struct{}),
	}
	go writer.run(context.WithoutCancel(ctx))
	return writer
}

func (writer *BufferedClickHouseWriter) WriteEvents(ctx context.Context, events []event.CanonicalEvent) error {
	if len(events) == 0 {
		return nil
	}
	request := &writeRequest{events: append([]event.CanonicalEvent(nil), events...), bytes: estimateEventsBytes(events), result: make(chan error, 1)}
	writer.enqueue.Lock()
	if writer.closed.Load() {
		writer.enqueue.Unlock()
		return ErrClickHouseWriterClosed
	}
	select {
	case writer.commands <- writerCommand{request: request}:
		writer.enqueue.Unlock()
	case <-ctx.Done():
		writer.enqueue.Unlock()
		return ctx.Err()
	}
	return <-request.result
}

func (writer *BufferedClickHouseWriter) Close() error {
	writer.enqueue.Lock()
	if writer.closed.Swap(true) {
		writer.enqueue.Unlock()
		<-writer.done
		return nil
	}
	result := make(chan error, 1)
	writer.commands <- writerCommand{close: result}
	writer.enqueue.Unlock()
	err := <-result
	<-writer.done
	return errors.Join(err, writer.connection.Close())
}

func (writer *BufferedClickHouseWriter) run(ctx context.Context) {
	defer close(writer.done)
	requests := make([]*writeRequest, 0)
	events := make([]event.CanonicalEvent, 0, writer.options.MaxRows)
	bytes := 0
	var timer *time.Timer
	var timerChannel <-chan time.Time
	stopTimer := func() {
		if timer != nil && !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer = nil
		timerChannel = nil
	}
	flush := func() error {
		stopTimer()
		if len(events) == 0 {
			return nil
		}
		err := writer.insertWithRetry(ctx, events)
		for _, request := range requests {
			request.result <- err
		}
		requests = requests[:0]
		events = events[:0]
		bytes = 0
		return err
	}
	for {
		select {
		case command := <-writer.commands:
			if command.close != nil {
				command.close <- flush()
				return
			}
			request := command.request
			if len(events) > 0 && (len(events)+len(request.events) > writer.options.MaxRows || bytes+request.bytes > writer.options.MaxBytes) {
				_ = flush()
			}
			requests = append(requests, request)
			events = append(events, request.events...)
			bytes += request.bytes
			if timer == nil {
				timer = time.NewTimer(writer.options.FlushInterval)
				timerChannel = timer.C
			}
			if len(events) >= writer.options.MaxRows || bytes >= writer.options.MaxBytes {
				_ = flush()
			}
		case <-timerChannel:
			_ = flush()
		}
	}
}

func (writer *BufferedClickHouseWriter) insertWithRetry(parent context.Context, events []event.CanonicalEvent) error {
	started := time.Now()
	token := eventBatchToken(events)
	var lastErr error
	for attempt := 1; attempt <= writer.options.MaxAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(parent, writer.options.AttemptTimeout)
		ctx = clickhouse.Context(ctx, clickhouse.WithSettings(clickhouse.Settings{
			"insert_deduplicate": 1, "insert_deduplication_token": token, "insert_distributed_sync": 1,
		}))
		lastErr = writer.insert(ctx, events)
		cancel()
		if lastErr == nil {
			if writer.options.Observer != nil {
				writer.options.Observer.ObserveClickHouseBatch(len(events), time.Since(started), nil)
			}
			return nil
		}
		if attempt < writer.options.MaxAttempts {
			time.Sleep(time.Duration(attempt*attempt) * 100 * time.Millisecond)
		}
	}
	err := fmt.Errorf("insert ClickHouse event batch after %d attempts: %w", writer.options.MaxAttempts, lastErr)
	if writer.options.Observer != nil {
		writer.options.Observer.ObserveClickHouseBatch(len(events), time.Since(started), err)
	}
	return err
}

func (writer *BufferedClickHouseWriter) insert(ctx context.Context, events []event.CanonicalEvent) error {
	batch, err := writer.connection.PrepareBatch(ctx, insertEventsQuery)
	if err != nil {
		return err
	}
	defer func() { _ = batch.Close() }()
	for _, current := range events {
		if err := batch.Append(
			current.ProjectID, current.EventID, string(current.EventType), current.Timestamp, current.ReceivedAt,
			current.Environment, current.Release, current.Dist, current.SessionID, current.AnonymousUserID, current.UserID, current.PageID,
			current.PageURL, current.PageURLNormalized, current.Route, current.Referrer, current.Title, current.NavigationType,
			current.SDKName, current.SDKVersion, current.SchemaVersion, current.SampleRate, current.Browser, current.BrowserVersion,
			current.OS, current.OSVersion, current.DeviceType, current.Country, current.TraceID, current.SpanID,
			current.ErrorType, current.ErrorMessage, current.ErrorStack, current.ErrorMechanism, current.Fingerprint, current.Handled,
			current.APIMethod, current.APIURLNormalized, current.APIStatus, current.APIFailure, current.DurationMS, current.TransferSize,
			current.MetricName, current.MetricValue, current.MetricDelta, current.MetricRating, current.CustomName,
			current.Attributes, current.Measurements, current.Breadcrumbs, current.IngestFlags,
		); err != nil {
			return err
		}
	}
	return batch.Send()
}

func eventBatchToken(events []event.CanonicalEvent) string {
	digest := sha256.New()
	for _, current := range events {
		_, _ = digest.Write(current.ProjectID[:])
		_, _ = digest.Write(current.EventID[:])
	}
	return fmt.Sprintf("openrum-%x", digest.Sum(nil))
}

func estimateEventsBytes(events []event.CanonicalEvent) int {
	total := 0
	for _, current := range events {
		total += 512 + len(current.PageURL) + len(current.PageURLNormalized) + len(current.Title) +
			len(current.ErrorMessage) + len(current.ErrorStack) + len(current.APIURLNormalized)
		for key, value := range current.Attributes {
			total += len(key) + len(value)
		}
		for _, breadcrumb := range current.Breadcrumbs {
			total += len(breadcrumb)
		}
	}
	return total
}
