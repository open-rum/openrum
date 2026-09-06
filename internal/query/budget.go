package query

import (
	"errors"
	"math"
	"time"
)

const defaultOverviewBudgetUnits = int64(4 * 8 * 24 * 60)

var ErrQueryTooExpensive = errors.New("query exceeds the overview scan budget")

// OverviewBudget bounds aggregate scans before they reach ClickHouse. A unit is
// one minute scanned by one of the four overview query families.
type OverviewBudget struct {
	MaxUnits int64
}

func DefaultOverviewBudget() OverviewBudget {
	return OverviewBudget{MaxUnits: defaultOverviewBudgetUnits}
}

func (budget OverviewBudget) Check(requested OverviewFilters) error {
	filters, err := NormalizeOverviewFilters(requested)
	if err != nil {
		return err
	}
	maximum := budget.MaxUnits
	if maximum <= 0 {
		maximum = defaultOverviewBudgetUnits
	}
	minutes := int64(math.Ceil(filters.To.Sub(filters.From).Minutes()))
	units := minutes * 4
	for _, value := range []string{filters.Environment, filters.Release, filters.Route} {
		if value != "" {
			units = max(1, units/4)
		}
	}
	if units > maximum {
		return ErrQueryTooExpensive
	}
	return nil
}

func OverviewQueryTimeout() time.Duration { return 10 * time.Second }
