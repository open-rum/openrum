package query

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizeOverviewFiltersUsesUTCInstantsAndPreviousPeriod(t *testing.T) {
	location := time.FixedZone("Asia/Shanghai", 8*60*60)
	filters, err := NormalizeOverviewFilters(OverviewFilters{
		ProjectID:   uuid.New(),
		From:        time.Date(2026, 9, 2, 8, 0, 0, 0, location),
		To:          time.Date(2026, 9, 2, 10, 30, 0, 0, location),
		Environment: " production ", Release: " web-42 ", Route: " /checkout ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if filters.From.Location() != time.UTC || filters.From.Hour() != 0 || filters.To.Hour() != 2 || filters.To.Minute() != 30 {
		t.Fatalf("UTC range=%s..%s", filters.From, filters.To)
	}
	if filters.Environment != "production" || filters.Release != "web-42" || filters.Route != "/checkout" {
		t.Fatalf("dimensions=%+v", filters)
	}
	previous := filters.previousPeriod()
	if !previous.To.Equal(filters.From) || previous.To.Sub(previous.From) != filters.To.Sub(filters.From) {
		t.Fatalf("previous=%s..%s current=%s..%s", previous.From, previous.To, filters.From, filters.To)
	}
}

func TestNormalizeOverviewFiltersRejectsUnboundedOrMalformedInput(t *testing.T) {
	base := OverviewFilters{ProjectID: uuid.New(), From: time.Now().UTC().Add(-time.Hour), To: time.Now().UTC()}
	tests := []struct {
		name   string
		mutate func(*OverviewFilters)
	}{
		{name: "project", mutate: func(filters *OverviewFilters) { filters.ProjectID = uuid.Nil }},
		{name: "reverse", mutate: func(filters *OverviewFilters) { filters.From = filters.To }},
		{name: "over 30 days", mutate: func(filters *OverviewFilters) { filters.From = filters.To.Add(-MaxOverviewRange - time.Second) }},
		{name: "environment", mutate: func(filters *OverviewFilters) { filters.Environment = "Production!" }},
		{name: "release", mutate: func(filters *OverviewFilters) { filters.Release = string(make([]byte, 129)) }},
		{name: "route newline", mutate: func(filters *OverviewFilters) { filters.Route = "/checkout\nadmin" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filters := base
			test.mutate(&filters)
			if _, err := NormalizeOverviewFilters(filters); !errors.Is(err, ErrInvalidOverviewFilters) {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestOverviewIntervalBoundsSeriesCardinality(t *testing.T) {
	tests := []struct {
		duration time.Duration
		want     time.Duration
	}{
		{time.Hour, time.Minute},
		{24 * time.Hour, 5 * time.Minute},
		{5 * 24 * time.Hour, 15 * time.Minute},
		{30 * 24 * time.Hour, time.Hour},
	}
	for _, test := range tests {
		if got := overviewInterval(test.duration); got != test.want {
			t.Errorf("interval(%s)=%s want=%s", test.duration, got, test.want)
		}
		if points := test.duration / test.want; points > 720 {
			t.Errorf("duration=%s interval=%s yields %d points", test.duration, test.want, points)
		}
	}
}
