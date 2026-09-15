package query

import (
	"github.com/google/uuid"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLogSearchIsBoundedAndParameterized(t *testing.T) {
	attributeClause, attributeArgs, attributeErr := logSearch(`attributes.level:custom`)
	if attributeErr != nil || attributeClause != "attributes[?]=?" || !reflect.DeepEqual(attributeArgs, []any{"level", "custom"}) {
		t.Fatalf("attribute namespace: %s %v %v", attributeClause, attributeArgs, attributeErr)
	}
	clause, args, err := logSearch(`severity:error message:"payment failed" order.id:"a' OR 1=1 --"`)
	if err != nil {
		t.Fatal(err)
	}
	if clause != "log_level=? AND position(log_message,?)>0 AND attributes[?]=?" || !reflect.DeepEqual(args, []any{"error", "payment failed", "order.id", "a' OR 1=1 --"}) {
		t.Fatalf("%s %v", clause, args)
	}
	for _, query := range []string{`severity:oops`, `"unclosed`, `a OR b`, `value:>10`, `order.id:`, `bad[]:x`, strings.Repeat("word ", 13)} {
		if _, _, err := logSearch(query); err == nil {
			t.Errorf("accepted %q", query)
		}
	}
	_, args, err = logSearch(`message:"line\nnext"`)
	if err != nil || args[0] != "line\nnext" {
		t.Fatalf("escaped value: %v %v", args, err)
	}
}

func TestLogFiltersIsolateProjectsAndValidateCursorAndRange(t *testing.T) {
	base := LogFilters{ProjectID: uuid.New(), From: time.Now().UTC().Add(-time.Hour), To: time.Now().UTC(), Query: "checkout", Country: "cn"}
	f, err := NormalizeLogFilters(base)
	if err != nil || f.Country != "CN" || f.Limit != 50 {
		t.Fatalf("%+v %v", f, err)
	}
	where, args := logWhere(f)
	if !strings.Contains(where, "project_id=? AND event_type='log'") || !strings.Contains(where, "raw_expires_at>now64(3)") || args[0] != f.ProjectID {
		t.Fatalf("unscoped query %s %v", where, args)
	}
	for _, mutate := range []func(*LogFilters){func(f *LogFilters) { f.ProjectID = uuid.Nil }, func(f *LogFilters) { f.To = f.From }, func(f *LogFilters) { f.To = f.From.Add(31 * 24 * time.Hour) }, func(f *LogFilters) { f.Limit = 101 }, func(f *LogFilters) { f.Query = strings.Repeat("a", 1025) }, func(f *LogFilters) { f.Cursor = "bad" }, func(f *LogFilters) { f.Cursor = encodeEventCursor(f.To, uuid.New()) }} {
		bad := base
		mutate(&bad)
		if _, err := NormalizeLogFilters(bad); err == nil {
			t.Fatalf("accepted %+v", bad)
		}
	}
	base.Cursor = encodeEventCursor(base.From.Add(time.Minute), uuid.New())
	if _, err := NormalizeLogFilters(base); err != nil {
		t.Fatal(err)
	}
}

func TestLogUserSearchUsesIdentityColumnsNotAttributes(t *testing.T) {
	for _, tc := range []struct{ key, column string }{
		{"user.id", "user_id"}, {"user_id", "user_id"}, {"userId", "user_id"},
		{"anonymous_user_id", "anonymous_user_id"}, {"anonymousUserId", "anonymous_user_id"},
	} {
		t.Run(tc.key, func(t *testing.T) {
			clause, args, err := logSearch(tc.key + `:"customer ' OR 1=1 --" severity:warn`)
			if err != nil || clause != tc.column+"=? AND log_level=?" || !reflect.DeepEqual(args, []any{"customer ' OR 1=1 --", "warn"}) {
				t.Fatalf("identity query: %s %v %v", clause, args, err)
			}
		})
	}
	clause, args, err := logSearch(`attributes.user.id:attribute-user user.id:actual-user`)
	if err != nil || clause != "attributes[?]=? AND user_id=?" || !reflect.DeepEqual(args, []any{"user.id", "attribute-user", "actual-user"}) {
		t.Fatalf("identity namespace: %s %v %v", clause, args, err)
	}
}
