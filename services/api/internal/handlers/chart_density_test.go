package handlers

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestChartPointBudgetParsing(t *testing.T) {
	for _, value := range []string{"", "24", "96", "240", "-1", "0", "23", "241", "1.5", "NaN", "96+MINUTE"} {
		valid := value == "" || value == "24" || value == "96" || value == "240"
		req := httptest.NewRequestWithContext(context.Background(), "GET", "/?from=2026-09-16T09:08:00Z&to=2026-09-23T09:08:00Z&maxPoints="+value, nil)
		id := uuid.New()
		overview, overviewErr := parseOverviewFilters(req, id)
		behavior, behaviorErr := parseBehaviorFilters(req, id)
		if (overviewErr == nil) != valid || (behaviorErr == nil) != valid {
			t.Fatalf("budget=%q overview=%v behavior=%v", value, overviewErr, behaviorErr)
		}
		if valid && overview.MaxPoints != behavior.MaxPoints {
			t.Fatal("sources disagree on point budget")
		}
	}
}
