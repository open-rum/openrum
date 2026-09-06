package query

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizeUsageFiltersBoundsRangeAndEventType(t *testing.T) {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	valid, err := NormalizeUsageFilters(UsageFilters{ProjectID: uuid.New(), From: from, To: from.Add(24 * time.Hour), EventType: " api "})
	if err != nil || valid.EventType != "api" {
		t.Fatalf("valid=%+v err=%v", valid, err)
	}
	for _, filters := range []UsageFilters{
		{ProjectID: uuid.Nil, From: from, To: from.Add(time.Hour)},
		{ProjectID: uuid.New(), From: from, To: from.Add(91 * 24 * time.Hour)},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), EventType: "api\nformula"},
	} {
		if _, err := NormalizeUsageFilters(filters); !errors.Is(err, ErrInvalidUsageFilters) {
			t.Fatalf("filters=%+v err=%v", filters, err)
		}
	}
}
