package query

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPathQueryDefaultsAndBounds(t *testing.T) {
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	input, err := NormalizePathQuery(PathQuery{ProjectID: uuid.New(), From: to.Add(-time.Hour), To: to})
	if err != nil || input.Depth != 5 || input.TopN != 20 {
		t.Fatalf("input=%+v err=%v", input, err)
	}
	input.Depth = 6
	if _, err := NormalizePathQuery(input); !errors.Is(err, ErrInvalidPathQuery) {
		t.Fatalf("depth error=%v", err)
	}
}

func TestPathBudgetRejectsTooWideQuery(t *testing.T) {
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	input := PathQuery{ProjectID: uuid.New(), From: to.Add(-7 * 24 * time.Hour), To: to, Depth: 5, TopN: 20}
	if err := CheckPathBudget(input); err != nil {
		t.Fatalf("bounded query rejected: %v", err)
	}
	input.From = to.Add(-8 * 24 * time.Hour)
	if err := CheckPathBudget(input); !errors.Is(err, ErrInvalidPathQuery) {
		t.Fatalf("wide query error=%v", err)
	}
}
