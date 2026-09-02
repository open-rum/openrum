package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"openrum/internal/migrate"
	"openrum/migrations"
)

func main() {
	if len(os.Args) < 2 || (os.Args[1] != "up" && os.Args[1] != "status") {
		log.Fatal("usage: migrate <up|status> [all|postgres|clickhouse]")
	}
	action := os.Args[1]
	target := "all"
	if len(os.Args) > 2 {
		target = os.Args[2]
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if target == "all" || target == "postgres" {
		if err := runPostgres(ctx, action); err != nil {
			log.Fatal(err)
		}
	}
	if target == "all" || target == "clickhouse" {
		if err := runClickHouse(ctx, action); err != nil {
			log.Fatal(err)
		}
	}
	if target != "all" && target != "postgres" && target != "clickhouse" {
		log.Fatalf("unknown database %q", target)
	}
}

func runPostgres(ctx context.Context, action string) error {
	database, err := migrate.OpenPostgres(required("POSTGRES_DSN"))
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()
	if action == "up" {
		if err := migrate.PostgresUp(ctx, database, migrations.Files); err != nil {
			return err
		}
	}
	status, err := migrate.PostgresStatus(ctx, database, migrations.Files)
	printStatus("postgres", status)
	return err
}

func runClickHouse(ctx context.Context, action string) error {
	database, err := migrate.OpenClickHouse(required("CLICKHOUSE_DSN"))
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()
	if action == "up" {
		if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
			return err
		}
	}
	status, err := migrate.ClickHouseStatus(ctx, database, migrations.Files)
	printStatus("clickhouse", status)
	return err
}

func printStatus(database string, status []migrate.Migration) {
	for _, migration := range status {
		state := "pending"
		if migration.Applied {
			state = "applied"
		}
		fmt.Printf("%s %04d %-8s %s\n", database, migration.Version, state, migration.Name)
	}
}

func required(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("%s is required", name)
	}
	return value
}
