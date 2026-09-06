package query

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizeSessionFiltersDefaults(t *testing.T) {
	from := time.Date(2026, 9, 4, 0, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	filters, err := NormalizeSessionFilters(SessionFilters{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if filters.Limit != 50 || filters.Page != 1 || filters.Sort != "latest" || filters.From.Location() != time.UTC {
		t.Fatalf("unexpected defaults: %+v", filters)
	}
}

func TestNormalizeSessionFiltersRejectsUnboundedValues(t *testing.T) {
	from := time.Now().UTC()
	tests := []SessionFilters{
		{ProjectID: uuid.New(), From: from, To: from.Add(31 * 24 * time.Hour)},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Search: string(make([]byte, 129))},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Signal: "unknown"},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Page: 101},
	}
	for _, filters := range tests {
		if _, err := NormalizeSessionFilters(filters); !errors.Is(err, ErrInvalidSessionFilters) {
			t.Fatalf("expected invalid filters for %+v, got %v", filters, err)
		}
	}
}

func TestSessionHavingKeepsSummaryRowsIntact(t *testing.T) {
	having, arguments := sessionHaving(SessionFilters{Route: "/checkout", Search: "alice", Signal: "error", MinimumEvents: 3, MinimumDuration: 60})
	if having == "" || len(arguments) != 10 {
		t.Fatalf("having=%q arguments=%v", having, arguments)
	}
}

func TestSessionHavingUsesWebVitalEvents(t *testing.T) {
	clause, _ := sessionHaving(SessionFilters{Signal: "poor_vital"})
	if !strings.Contains(clause, "event_type='web_vital'") {
		t.Fatalf("expected poor vital filter to use web_vital events, got %q", clause)
	}
}
