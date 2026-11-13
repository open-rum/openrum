package query

import (
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLogSearchIsBoundedAndParameterized(t *testing.T) {
	attributeClause, attributeArgs, attributeErr := logSearch(`attributes.level:custom`)
	if attributeErr != nil || attributeClause != "(attributes[?] = ?)" || !reflect.DeepEqual(attributeArgs, []any{"level", "custom"}) {
		t.Fatalf("attribute namespace: %s %v %v", attributeClause, attributeArgs, attributeErr)
	}
	clause, args, err := logSearch(`severity:error message:"payment failed" order.id:"a' OR 1=1 --"`)
	if err != nil {
		t.Fatal(err)
	}
	if clause != "(log_level = ?) AND (position(log_message, ?) > 0) AND (attributes[?] = ?)" || !reflect.DeepEqual(args, []any{"error", "payment failed", "order.id", "a' OR 1=1 --"}) {
		t.Fatalf("%s %v", clause, args)
	}
	for _, query := range []string{`severity:oops`, `"unclosed`, `a OR b`, `value:>10`, `order.id:`, `session_id:not-a-uuid`, strings.Repeat("word ", 13)} {
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
			if err != nil || clause != "("+tc.column+" = ?) AND (log_level = ?)" || !reflect.DeepEqual(args, []any{"customer ' OR 1=1 --", "warn"}) {
				t.Fatalf("identity query: %s %v %v", clause, args, err)
			}
		})
	}
	clause, args, err := logSearch(`attributes.user.id:attribute-user user.id:actual-user`)
	if err != nil || clause != "(attributes[?] = ?) AND (user_id = ?)" || !reflect.DeepEqual(args, []any{"user.id", "attribute-user", "actual-user"}) {
		t.Fatalf("identity namespace: %s %v %v", clause, args, err)
	}
}

func TestLogSearchTakesTheSharedOperators(t *testing.T) {
	clause, args, err := logSearch(`!level:[debug,trace] has:trace_id logger:checkout* !timeout`)
	if err != nil {
		t.Fatal(err)
	}
	want := "NOT (log_level IN (?,?)) AND (trace_id != '') AND (startsWith(log_logger, ?)) AND NOT (position(log_message, ?) > 0)"
	if clause != want || !reflect.DeepEqual(args, []any{"debug", "trace", "checkout", "timeout"}) {
		t.Fatalf("%s %v", clause, args)
	}
	// The old "has a trace" shortcut wrote trace_id:*, which used to look for a literal *.
	clause, _, err = logSearch(`trace_id:*`)
	if err != nil || clause != "(trace_id != '')" {
		t.Fatalf("trace_id:* = %s %v", clause, err)
	}
}

func TestLogSeriesBudgetPreservesLegacyAndUsesSharedPolicy(t *testing.T) {
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	for _, window := range []time.Duration{5 * time.Minute, time.Hour, 6 * time.Hour, 24 * time.Hour, 7 * 24 * time.Hour, 30 * 24 * time.Hour} {
		f := LogFilters{ProjectID: uuid.New(), From: from, To: from.Add(window), MaxPoints: ConsoleSeriesMaxPoints}
		if _, err := NormalizeLogFilters(f); err != nil {
			t.Fatal(err)
		}
		if got, want := time.Duration(logInterval(f))*time.Second, ConsoleSeriesInterval(window, time.Minute); got != want {
			t.Fatalf("%v: got %v want %v", window, got, want)
		}
	}
	if logInterval(LogFilters{From: from, To: from.Add(24 * time.Hour)}) != 900 {
		t.Fatal("changed legacy resolution")
	}
	for _, budget := range []int{-1, 1, 23, 241} {
		if _, err := NormalizeLogFilters(LogFilters{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), MaxPoints: budget}); err == nil {
			t.Fatalf("accepted %d", budget)
		}
	}
}

func TestLogIDSearchIsTypedAndParameterized(t *testing.T) {
	id := uuid.New()
	clause, args, err := logSearch(`event_id:"` + id.String() + `"`)
	if err != nil || clause != "(event_id = ?)" || len(args) != 1 {
		t.Fatalf("%s %v %v", clause, args, err)
	}
	if _, _, err := logSearch(`event_id:not-an-id`); err == nil {
		t.Fatal("accepted invalid log ID")
	}
}

func TestLogContextValidation(t *testing.T) {
	base := LogFilters{ProjectID: uuid.New(), From: time.Now().UTC().Add(-time.Hour), To: time.Now().UTC(), Anchor: uuid.NewString(), AnchorAt: time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)}
	for _, mutate := range []func(*LogFilters){
		func(f *LogFilters) { f.Anchor = "invalid" },
		func(f *LogFilters) { f.AnchorAt = "" },
		func(f *LogFilters) { f.Anchor = "" },
		func(f *LogFilters) { f.Direction = "before" },
		func(f *LogFilters) {
			f.Direction = "DESC; DROP TABLE rum_events"
			f.Cursor = encodeEventCursor(f.From, uuid.New())
		},
	} {
		bad := base
		mutate(&bad)
		if _, err := NormalizeLogFilters(bad); err == nil {
			t.Fatalf("accepted %+v", bad)
		}
	}
	if _, err := NormalizeLogFilters(base); err != nil {
		t.Fatal(err)
	}
}

func TestLogWindowsKeepProjectFiltersAndMillisecondPrecision(t *testing.T) {
	at := time.Date(2026, 11, 11, 13, 21, 31, 184000000, time.UTC)
	f := LogFilters{ProjectID: uuid.New(), From: at.Add(-time.Hour), To: at.Add(time.Hour), Environment: "production", Query: `session_id:"` + uuid.NewString() + `"`}
	pivot := &eventCursor{Timestamp: at, EventID: uuid.New()}
	statement, args := logWindowQuery(f, logWindow{pivot: pivot, comparison: ">=", ascending: true, limit: 25})
	for _, fragment := range []string{"project_id=?", "environment=?", "session_id = ?", "raw_expires_at>now64(3)", "(timestamp,event_id)>=(toDateTime64(?,3,'UTC'),?)", "ORDER BY timestamp ASC,event_id ASC", logQuerySettings} {
		if !strings.Contains(statement, fragment) {
			t.Fatalf("missing %s in %s", fragment, statement)
		}
	}
	if args[len(args)-3] != "2026-11-11 13:21:31.184" || args[len(args)-2] != pivot.EventID || args[len(args)-1] != 26 {
		t.Fatalf("boundary %v", args)
	}
}

func TestLogContextPagesChronologicallyWithoutSkippingTimestampTies(t *testing.T) {
	at := time.Date(2026, 11, 11, 13, 21, 31, 184000000, time.UTC)
	all := []LogEntry{}
	for i := 0; i < 103; i++ {
		all = append(all, LogEntry{EventID: uuid.MustParse(fmt.Sprintf("00000000-0000-4000-8000-%012d", i)), Timestamp: at.Add(time.Duration(i/3) * time.Millisecond)})
	}
	fetch := func(window logWindow) ([]LogEntry, error) {
		result := []LogEntry{}
		for _, item := range all {
			if window.pivot != nil {
				comparison := item.Timestamp.Compare(window.pivot.Timestamp)
				if comparison == 0 {
					comparison = strings.Compare(item.EventID.String(), window.pivot.EventID.String())
				}
				if (window.comparison == "<" && comparison >= 0) || (window.comparison == ">" && comparison <= 0) || (window.comparison == ">=" && comparison < 0) {
					continue
				}
			}
			result = append(result, item)
		}
		if !window.ascending {
			slices.Reverse(result)
		}
		return result[:min(len(result), window.limit+1)], nil
	}
	for _, anchorIndex := range []int{0, 2, 50, 100, 102} {
		anchor := all[anchorIndex]
		f := LogFilters{Limit: 10, Anchor: anchor.EventID.String(), AnchorAt: anchor.Timestamp.Format(time.RFC3339Nano)}
		initial, previous, next, err := loadLogItems(f, fetch)
		if err != nil || len(initial) > f.Limit {
			t.Fatalf("initial %d %v", len(initial), err)
		}
		seen := append([]LogEntry{}, initial...)
		for next != "" {
			f.Cursor, f.Direction = next, "after"
			var batch []LogEntry
			batch, _, next, err = loadLogItems(f, fetch)
			if err != nil || len(batch) == 0 {
				t.Fatalf("after %v", err)
			}
			seen = append(seen, batch...)
			if len(seen) > len(all) {
				t.Fatal("duplicate forward page")
			}
		}
		for previous != "" {
			f.Cursor, f.Direction = previous, "before"
			var batch []LogEntry
			batch, previous, _, err = loadLogItems(f, fetch)
			if err != nil || len(batch) == 0 {
				t.Fatalf("before %v", err)
			}
			seen = append(batch, seen...)
			if len(seen) > len(all) {
				t.Fatal("duplicate backward page")
			}
		}
		if !reflect.DeepEqual(seen, all) {
			t.Fatalf("anchor %d: skipped, repeated or unordered records (%d)", anchorIndex, len(seen))
		}
	}
	// Existing clients keep newest-first pagination.
	f := LogFilters{Limit: 10}
	first, previous, next, err := loadLogItems(f, fetch)
	if err != nil || previous != "" || next == "" || first[0].EventID != all[102].EventID {
		t.Fatalf("legacy %v %s %s", err, previous, next)
	}
	f.Cursor = next
	second, _, _, _ := loadLogItems(f, fetch)
	if second[0].EventID != all[92].EventID {
		t.Fatal("legacy cursor skipped entries")
	}
}
