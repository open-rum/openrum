package migrate

import (
	"reflect"
	"testing"
)

func TestSplitClickHouseStatements(t *testing.T) {
	source := `
-- a semicolon in a comment; is not a boundary
CREATE TABLE first (value String DEFAULT 'a;b') ENGINE = Memory;
/* nor is this one; */
CREATE TABLE second (` + "`quoted;name`" + ` UInt8) ENGINE = Memory;
`
	want := []string{
		"-- a semicolon in a comment; is not a boundary\nCREATE TABLE first (value String DEFAULT 'a;b') ENGINE = Memory",
		"/* nor is this one; */\nCREATE TABLE second (`quoted;name` UInt8) ENGINE = Memory",
	}
	if got := splitClickHouseStatements(source); !reflect.DeepEqual(got, want) {
		t.Fatalf("split statements = %#v, want %#v", got, want)
	}
}
