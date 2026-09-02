package migrations

import "embed"

// Files contains the immutable migration sources shipped with the migration binary.
//
//go:embed postgres/*.up.sql postgres/*.down.sql clickhouse/*.up.sql
var Files embed.FS
