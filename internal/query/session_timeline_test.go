package query

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizeSessionTimelineFilters(t *testing.T) {
	from := time.Date(2026, 9, 12, 0, 0, 0, 0, time.UTC)
	filters, cursor, err := normalizeSessionTimelineFilters(SessionTimelineFilters{
		ProjectID: uuid.New(), SessionID: uuid.New(), From: from, To: from.Add(24 * time.Hour),
		Kinds: []string{"page_view", "click", "web_vital"},
	})
	if err != nil || cursor != nil || filters.Limit != 100 {
		t.Fatalf("filters=%+v cursor=%+v err=%v", filters, cursor, err)
	}
	lastEventID := uuid.New()
	encoded := encodeEventCursor(from.Add(time.Second), lastEventID)
	filters.Cursor = encoded
	_, cursor, err = normalizeSessionTimelineFilters(filters)
	if err != nil || cursor == nil || cursor.EventID != lastEventID {
		t.Fatalf("cursor=%+v err=%v", cursor, err)
	}
}

func TestNormalizeSessionTimelineFiltersRejectsInvalidInputs(t *testing.T) {
	from := time.Date(2026, 9, 12, 0, 0, 0, 0, time.UTC)
	base := SessionTimelineFilters{ProjectID: uuid.New(), SessionID: uuid.New(), From: from, To: from.Add(time.Hour)}
	for name, mutate := range map[string]func(*SessionTimelineFilters){
		"over 24 hours":  func(value *SessionTimelineFilters) { value.To = value.From.Add(24*time.Hour + time.Millisecond) },
		"unknown kind":   func(value *SessionTimelineFilters) { value.Kinds = []string{"replay"} },
		"duplicate kind": func(value *SessionTimelineFilters) { value.Kinds = []string{"api", "api"} },
		"invalid cursor": func(value *SessionTimelineFilters) { value.Cursor = "not-base64" },
		"large limit":    func(value *SessionTimelineFilters) { value.Limit = 101 },
	} {
		t.Run(name, func(t *testing.T) {
			value := base
			mutate(&value)
			if _, _, err := normalizeSessionTimelineFilters(value); err == nil {
				t.Fatal("expected invalid timeline filters")
			}
		})
	}
}
