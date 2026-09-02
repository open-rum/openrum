package migrate

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const postgresMigrationTable = `CREATE TABLE IF NOT EXISTS openrum_schema_migrations (
  version BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`

func OpenPostgres(dsn string) (*sql.DB, error) {
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	return database, nil
}

func PostgresStatus(ctx context.Context, database *sql.DB, source fs.FS) ([]Migration, error) {
	if _, err := database.ExecContext(ctx, postgresMigrationTable); err != nil {
		return nil, fmt.Errorf("create PostgreSQL migration table: %w", err)
	}
	migrations, err := load(source, "postgres")
	if err != nil {
		return nil, err
	}
	rows, err := database.QueryContext(ctx, "SELECT version FROM openrum_schema_migrations")
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	applied := map[int64]bool{}
	for rows.Next() {
		var version int64
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		applied[version] = true
	}
	return withApplied(migrations, applied), rows.Err()
}

func PostgresUp(ctx context.Context, database *sql.DB, source fs.FS) error {
	connection, err := database.Conn(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = connection.Close() }()
	if _, err := connection.ExecContext(ctx, "SELECT pg_advisory_lock(764680621012)"); err != nil {
		return fmt.Errorf("lock PostgreSQL migrations: %w", err)
	}
	defer connection.ExecContext(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock(764680621012)") //nolint:errcheck

	if _, err := connection.ExecContext(ctx, postgresMigrationTable); err != nil {
		return err
	}
	migrations, err := load(source, "postgres")
	if err != nil {
		return err
	}
	for _, migration := range migrations {
		var exists bool
		if err := connection.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM openrum_schema_migrations WHERE version=$1)", migration.Version).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		transaction, err := connection.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := transaction.ExecContext(ctx, migration.SQL); err != nil {
			_ = transaction.Rollback()
			return fmt.Errorf("apply PostgreSQL migration %s: %w", migration.Name, err)
		}
		if _, err := transaction.ExecContext(ctx, "INSERT INTO openrum_schema_migrations (version, name) VALUES ($1, $2)", migration.Version, migration.Name); err != nil {
			_ = transaction.Rollback()
			return err
		}
		if err := transaction.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func PostgresDown(ctx context.Context, database *sql.DB, source fs.FS) error {
	connection, err := database.Conn(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = connection.Close() }()
	if _, err := connection.ExecContext(ctx, "SELECT pg_advisory_lock(764680621012)"); err != nil {
		return fmt.Errorf("lock PostgreSQL migrations: %w", err)
	}
	defer connection.ExecContext(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock(764680621012)") //nolint:errcheck

	if _, err := connection.ExecContext(ctx, postgresMigrationTable); err != nil {
		return err
	}
	var version int64
	if err := connection.QueryRowContext(ctx, "SELECT version FROM openrum_schema_migrations ORDER BY version DESC LIMIT 1").Scan(&version); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	downMigrations, err := loadDown(source, "postgres")
	if err != nil {
		return err
	}
	var selected *Migration
	for index := range downMigrations {
		if downMigrations[index].Version == version {
			selected = &downMigrations[index]
			break
		}
	}
	if selected == nil {
		return fmt.Errorf("PostgreSQL migration %04d has no down migration", version)
	}

	transaction, err := connection.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, selected.SQL); err != nil {
		_ = transaction.Rollback()
		return fmt.Errorf("revert PostgreSQL migration %s: %w", selected.Name, err)
	}
	if _, err := transaction.ExecContext(ctx, "DELETE FROM openrum_schema_migrations WHERE version=$1", version); err != nil {
		_ = transaction.Rollback()
		return err
	}
	return transaction.Commit()
}
