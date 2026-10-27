package query

import (
	"context"

	"github.com/ClickHouse/clickhouse-go/v2"
)

// boundedQueryContext makes ClickHouse stop a list query after ten seconds, the same limit the
// handlers put on the request. Without it, a cancelled request leaves the query running on the
// server; every list page shares this limit so none can hold the cluster longer than the rest.
func boundedQueryContext(ctx context.Context) context.Context {
	return clickhouse.Context(ctx, clickhouse.WithSettings(clickhouse.Settings{
		"max_execution_time":    10,
		"timeout_overflow_mode": "throw",
	}))
}
