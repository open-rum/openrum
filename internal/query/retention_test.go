package query

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRetentionQueryDefaultsAndBounds(t *testing.T) {
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	input, err := NormalizeRetentionQuery(RetentionQuery{ProjectID: uuid.New(), From: to.Add(-28 * 24 * time.Hour), To: to})
	if err != nil || input.Weeks != 8 {
		t.Fatalf("input=%+v err=%v", input, err)
	}
	input.Weeks = 3
	if _, err := NormalizeRetentionQuery(input); !errors.Is(err, ErrInvalidRetentionQuery) {
		t.Fatalf("weeks error=%v", err)
	}
}

func TestRetentionBudgetAcceptsTwelveWeeksOnly(t *testing.T) {
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	input := RetentionQuery{ProjectID: uuid.New(), From: to.Add(-12 * 7 * 24 * time.Hour), To: to, Weeks: 12}
	if err := CheckRetentionBudget(input); err != nil {
		t.Fatalf("bounded query rejected: %v", err)
	}
	input.Weeks = 8
	if err := CheckRetentionBudget(input); !errors.Is(err, ErrInvalidRetentionQuery) {
		t.Fatalf("mismatched range error=%v", err)
	}
}
