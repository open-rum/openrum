package internal

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
)

type AlertWindow struct {
	StartedAt time.Time
	EndedAt   time.Time
}

type AlertEvaluation struct {
	RuleID    uuid.UUID
	Window    AlertWindow
	Value     *float64
	Status    string
	ErrorCode string
}

type AlertRuleSource interface {
	ListEnabled(context.Context) ([]metadata.AlertRule, error)
}

type AlertMetricReader interface {
	Read(context.Context, metadata.AlertRule, AlertWindow) (float64, error)
}

type AlertEvaluationStore interface {
	Record(context.Context, metadata.AlertRule, AlertEvaluation) (bool, error)
	MarkNotified(context.Context, uuid.UUID, AlertWindow, time.Time) error
}

type AlertDispatcher interface {
	Dispatch(context.Context, metadata.AlertRule, AlertWindow, float64) error
}

type AlertEvaluator struct {
	rules      AlertRuleSource
	metrics    AlertMetricReader
	history    AlertEvaluationStore
	dispatcher AlertDispatcher
	now        func() time.Time
}

func NewAlertEvaluator(rules AlertRuleSource, metrics AlertMetricReader, history AlertEvaluationStore, dispatcher AlertDispatcher) *AlertEvaluator {
	return &AlertEvaluator{rules: rules, metrics: metrics, history: history, dispatcher: dispatcher, now: time.Now}
}

func (evaluator *AlertEvaluator) Evaluate(ctx context.Context) error {
	rules, err := evaluator.rules.ListEnabled(ctx)
	if err != nil {
		return fmt.Errorf("list alert rules: %w", err)
	}
	var result error
	for _, rule := range rules {
		window := fixedAlertWindow(evaluator.now().UTC(), time.Duration(rule.WindowMinutes)*time.Minute)
		value, readErr := evaluator.metrics.Read(ctx, rule, window)
		if readErr != nil {
			code := "metric_unavailable"
			_, recordErr := evaluator.history.Record(ctx, rule, AlertEvaluation{RuleID: rule.ID, Window: window, Status: "failed", ErrorCode: code})
			result = errors.Join(result, readErr, recordErr)
			continue
		}
		status := "ok"
		if alertBreached(rule.Comparator, value, rule.Threshold) {
			status = "breached"
		}
		shouldNotify, recordErr := evaluator.history.Record(ctx, rule, AlertEvaluation{RuleID: rule.ID, Window: window, Value: &value, Status: status})
		if recordErr != nil {
			result = errors.Join(result, recordErr)
			continue
		}
		if !shouldNotify || evaluator.dispatcher == nil {
			continue
		}
		if err := evaluator.dispatcher.Dispatch(ctx, rule, window, value); err != nil {
			result = errors.Join(result, err)
			continue
		}
		result = errors.Join(result, evaluator.history.MarkNotified(ctx, rule.ID, window, evaluator.now().UTC()))
	}
	return result
}

func fixedAlertWindow(now time.Time, duration time.Duration) AlertWindow {
	if duration <= 0 {
		duration = 5 * time.Minute
	}
	endedAt := now.Truncate(duration)
	return AlertWindow{StartedAt: endedAt.Add(-duration), EndedAt: endedAt}
}

func alertBreached(comparator string, value, threshold float64) bool {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return false
	}
	if comparator == "gt" {
		return value > threshold
	}
	return value >= threshold
}

type PostgresAlertStore struct{ database *sql.DB }

func NewPostgresAlertStore(database *sql.DB) *PostgresAlertStore {
	return &PostgresAlertStore{database: database}
}

func (store *PostgresAlertStore) ListEnabled(ctx context.Context) ([]metadata.AlertRule, error) {
	rows, err := store.database.QueryContext(ctx, `SELECT id,project_id,name,metric,comparator,threshold,
		window_minutes,cooldown_minutes,environment,enabled,created_by,created_at,updated_at
		FROM alert_rules WHERE enabled=true ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	rules := make([]metadata.AlertRule, 0)
	for rows.Next() {
		var rule metadata.AlertRule
		if err := rows.Scan(&rule.ID, &rule.ProjectID, &rule.Name, &rule.Metric, &rule.Comparator,
			&rule.Threshold, &rule.WindowMinutes, &rule.CooldownMinutes, &rule.Environment, &rule.Enabled,
			&rule.CreatedBy, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, rows.Err()
}

func (store *PostgresAlertStore) Record(ctx context.Context, rule metadata.AlertRule, evaluation AlertEvaluation) (bool, error) {
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))", rule.ID); err != nil {
		return false, err
	}
	// A window is recorded once. It is offered for delivery again only while it is a
	// breach that no channel has accepted yet, up to maxDeliveryAttempts per channel.
	var existingID uuid.UUID
	var existingStatus string
	var notified sql.NullTime
	err = transaction.QueryRowContext(ctx, `SELECT id, status, notified_at FROM alert_evaluations
		WHERE rule_id=$1 AND window_started_at=$2 AND window_ended_at=$3`, rule.ID, evaluation.Window.StartedAt,
		evaluation.Window.EndedAt).Scan(&existingID, &existingStatus, &notified)
	if err == nil {
		if existingStatus != "breached" || notified.Valid {
			return false, nil
		}
		var attempts int
		if err := transaction.QueryRowContext(ctx, `SELECT coalesce(max(attempts), 0) FROM (
			SELECT count(*) AS attempts FROM alert_deliveries WHERE evaluation_id=$1 GROUP BY channel_id) per_channel`,
			existingID).Scan(&attempts); err != nil {
			return false, err
		}
		return attempts < maxDeliveryAttempts, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	status := evaluation.Status
	if status == "breached" {
		var lastNotified sql.NullTime
		if err := transaction.QueryRowContext(ctx, "SELECT max(notified_at) FROM alert_evaluations WHERE rule_id=$1", rule.ID).Scan(&lastNotified); err != nil {
			return false, err
		}
		if lastNotified.Valid && evaluation.Window.EndedAt.Before(lastNotified.Time.Add(time.Duration(rule.CooldownMinutes)*time.Minute)) {
			status = "suppressed"
		}
	}
	if _, err := transaction.ExecContext(ctx, `INSERT INTO alert_evaluations
		(rule_id,window_started_at,window_ended_at,value,status,error_code) VALUES ($1,$2,$3,$4,$5,$6)`,
		rule.ID, evaluation.Window.StartedAt, evaluation.Window.EndedAt, evaluation.Value, status, evaluation.ErrorCode); err != nil {
		return false, err
	}
	if err := transaction.Commit(); err != nil {
		return false, err
	}
	return status == "breached", nil
}

func (store *PostgresAlertStore) MarkNotified(ctx context.Context, ruleID uuid.UUID, window AlertWindow, at time.Time) error {
	result, err := store.database.ExecContext(ctx, `UPDATE alert_evaluations SET notified_at=$1
		WHERE rule_id=$2 AND window_started_at=$3 AND window_ended_at=$4 AND status='breached' AND notified_at IS NULL`,
		at, ruleID, window.StartedAt, window.EndedAt)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("alert evaluation notification was not claimable")
	}
	return nil
}

type ClickHouseAlertMetrics struct{ database *sql.DB }

func NewClickHouseAlertMetrics(database *sql.DB) *ClickHouseAlertMetrics {
	return &ClickHouseAlertMetrics{database: database}
}

func (metrics *ClickHouseAlertMetrics) Read(ctx context.Context, rule metadata.AlertRule, window AlertWindow) (float64, error) {
	where := "project_id=? AND bucket>=? AND bucket<?"
	arguments := []any{rule.ProjectID, window.StartedAt, window.EndedAt}
	if rule.Environment != "" {
		where += " AND environment=?"
		arguments = append(arguments, rule.Environment)
	}
	var expression string
	switch rule.Metric {
	case metadata.AlertErrorCount:
		expression = "coalesce(sumMerge(error_estimated),0)"
	case metadata.AlertErrorRate:
		expression = "if(sumMerge(page_view_estimated)=0,0,sumMerge(error_estimated)/sumMerge(page_view_estimated)*100)"
	case metadata.AlertAPIFailureRate:
		expression = "if(uniqCombined64Merge(api_requests)=0,0,uniqCombined64Merge(api_failures)/uniqCombined64Merge(api_requests)*100)"
	case metadata.AlertLCPP75:
		expression = "quantileTDigestMerge(0.75)(lcp_p75)"
	default:
		return 0, errors.New("unsupported alert metric")
	}
	var value sql.NullFloat64
	if err := metrics.database.QueryRowContext(ctx, "SELECT "+expression+" FROM project_metrics_1m WHERE "+where, arguments...).Scan(&value); err != nil {
		return 0, err
	}
	if !value.Valid {
		return 0, nil
	}
	return value.Float64, nil
}
