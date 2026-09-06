package internal

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

const alertLeaderLockID int64 = 764680621013

type AlertLeaderLease interface{ Close() error }

type AlertLeaderElector interface {
	TryAcquire(context.Context) (AlertLeaderLease, bool, error)
}

type AlertScheduler struct {
	leaders   AlertLeaderElector
	evaluator *AlertEvaluator
}

func NewAlertScheduler(leaders AlertLeaderElector, evaluator *AlertEvaluator) *AlertScheduler {
	return &AlertScheduler{leaders: leaders, evaluator: evaluator}
}

func (scheduler *AlertScheduler) Tick(ctx context.Context) error {
	lease, leader, err := scheduler.leaders.TryAcquire(ctx)
	if err != nil || !leader {
		return err
	}
	defer func() { _ = lease.Close() }()
	return scheduler.evaluator.Evaluate(ctx)
}

func (scheduler *AlertScheduler) Run(ctx context.Context) error {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if err := scheduler.Tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

type PostgresAlertLeader struct{ database *sql.DB }

func NewPostgresAlertLeader(database *sql.DB) *PostgresAlertLeader {
	return &PostgresAlertLeader{database: database}
}

func (leader *PostgresAlertLeader) TryAcquire(ctx context.Context) (AlertLeaderLease, bool, error) {
	connection, err := leader.database.Conn(ctx)
	if err != nil {
		return nil, false, err
	}
	var acquired bool
	if err := connection.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", alertLeaderLockID).Scan(&acquired); err != nil {
		_ = connection.Close()
		return nil, false, err
	}
	if !acquired {
		_ = connection.Close()
		return nil, false, nil
	}
	return &postgresAlertLease{connection: connection}, true, nil
}

type postgresAlertLease struct{ connection *sql.Conn }

func (lease *postgresAlertLease) Close() error {
	if lease.connection == nil {
		return nil
	}
	_, unlockErr := lease.connection.ExecContext(context.Background(), "SELECT pg_advisory_unlock($1)", alertLeaderLockID)
	closeErr := lease.connection.Close()
	lease.connection = nil
	return errors.Join(unlockErr, closeErr)
}
