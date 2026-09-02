package migrate

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"strings"

	_ "github.com/ClickHouse/clickhouse-go/v2"
)

const clickHouseMigrationTable = `CREATE TABLE IF NOT EXISTS openrum_schema_migrations (
  version UInt64,
  name String,
  applied_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(applied_at) ORDER BY version`

func OpenClickHouse(dsn string) (*sql.DB, error) {
	database, err := sql.Open("clickhouse", dsn)
	if err != nil {
		return nil, err
	}
	return database, nil
}

func ClickHouseStatus(ctx context.Context, database *sql.DB, source fs.FS) ([]Migration, error) {
	if _, err := database.ExecContext(ctx, clickHouseMigrationTable); err != nil {
		return nil, fmt.Errorf("create ClickHouse migration table: %w", err)
	}
	migrations, err := load(source, "clickhouse")
	if err != nil {
		return nil, err
	}
	rows, err := database.QueryContext(ctx, "SELECT DISTINCT version FROM openrum_schema_migrations")
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	applied := map[int64]bool{}
	for rows.Next() {
		var version uint64
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		applied[int64(version)] = true
	}
	return withApplied(migrations, applied), rows.Err()
}

func ClickHouseUp(ctx context.Context, database *sql.DB, source fs.FS) error {
	if _, err := database.ExecContext(ctx, clickHouseMigrationTable); err != nil {
		return err
	}
	migrations, err := load(source, "clickhouse")
	if err != nil {
		return err
	}
	for _, migration := range migrations {
		var count uint64
		if err := database.QueryRowContext(ctx, "SELECT count() FROM openrum_schema_migrations WHERE version = ?", migration.Version).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		for _, statement := range splitClickHouseStatements(migration.SQL) {
			if _, err := database.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("apply ClickHouse migration %s: %w", migration.Name, err)
			}
		}
		if _, err := database.ExecContext(ctx, "INSERT INTO openrum_schema_migrations (version, name) VALUES (?, ?)", migration.Version, migration.Name); err != nil {
			return err
		}
	}
	return nil
}

func splitClickHouseStatements(source string) []string {
	statements := make([]string, 0, 4)
	start := 0
	quote := rune(0)
	escaped := false
	inLineComment := false
	inBlockComment := false
	runes := []rune(source)
	for index, current := range runes {
		next := rune(0)
		if index+1 < len(runes) {
			next = runes[index+1]
		}
		if inLineComment {
			if current == '\n' {
				inLineComment = false
			}
			continue
		}
		if inBlockComment {
			if current == '*' && next == '/' {
				inBlockComment = false
			}
			continue
		}
		if quote != 0 {
			if escaped {
				escaped = false
				continue
			}
			if current == '\\' {
				escaped = true
				continue
			}
			if current == quote {
				quote = 0
			}
			continue
		}
		if current == '-' && next == '-' {
			inLineComment = true
			continue
		}
		if current == '/' && next == '*' {
			inBlockComment = true
			continue
		}
		if current == '\'' || current == '"' || current == '`' {
			quote = current
			continue
		}
		if current == ';' {
			if statement := strings.TrimSpace(string(runes[start:index])); statement != "" {
				statements = append(statements, statement)
			}
			start = index + 1
		}
	}
	if statement := strings.TrimSpace(string(runes[start:])); statement != "" {
		statements = append(statements, statement)
	}
	return statements
}
