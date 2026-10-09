package metadata

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"openrum/internal/catalog"
)

const MaxDashboardWidgets = 24

// MaxDashboardGroupTabs bounds a tabbed card: adjacent modules sharing a groupId.
const MaxDashboardGroupTabs = 3

type DashboardConfig struct {
	SchemaVersion int               `json:"schemaVersion"`
	Widgets       []json.RawMessage `json:"widgets"`
}

type dashboardWidget struct {
	ID             string          `json:"id"`
	Type           string          `json:"type"`
	Version        int             `json:"version"`
	Title          string          `json:"title"`
	Size           string          `json:"size"`
	View           string          `json:"view"`
	StatAppearance json.RawMessage `json:"statAppearance,omitempty"`
	GroupID        string          `json:"groupId,omitempty"`
	Data           struct {
		Source    string   `json:"source"`
		Metrics   []string `json:"metrics"`
		Release   string   `json:"release,omitempty"`
		Route     string   `json:"route,omitempty"`
		EventKind string   `json:"eventKind,omitempty"`
		EventName string   `json:"eventName,omitempty"`
		Dimension string   `json:"dimension,omitempty"`
	} `json:"data"`
}

var dashboardID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)
var dashboardProperty = regexp.MustCompile(`^property:[a-zA-Z][a-zA-Z0-9_.-]{0,63}$`)

// Unknown modules from a newer deployment may be retained verbatim or removed,
// but clients cannot register executable modules or invent query capabilities.
func ValidateDashboardConfig(raw, previous json.RawMessage) error {
	var config DashboardConfig
	if len(raw) > 65536 || strictDashboardJSON(raw, &config) != nil || config.SchemaVersion != 1 || config.Widgets == nil || len(config.Widgets) > MaxDashboardWidgets {
		return fmt.Errorf("dashboard must use schema version 1 and contain at most %d modules", MaxDashboardWidgets)
	}
	var old DashboardConfig
	_ = json.Unmarshal(previous, &old)
	seen := map[string]bool{}
	members := make([]dashboardGroupMember, 0, len(config.Widgets))
	for _, rawWidget := range config.Widgets {
		var identity struct {
			ID      string `json:"id"`
			Type    string `json:"type"`
			Version int    `json:"version"`
			Size    string `json:"size"`
			GroupID string `json:"groupId"`
		}
		if json.Unmarshal(rawWidget, &identity) != nil || !dashboardID.MatchString(identity.ID) || seen[identity.ID] {
			return fmt.Errorf("module IDs must be valid and unique")
		}
		seen[identity.ID] = true
		members = append(members, dashboardGroupMember{groupID: identity.GroupID, moduleType: identity.Type, size: identity.Size})
		switch {
		case identity.Version == 1 && slices.Contains(classicWidgetTypes, identity.Type):
			var widget dashboardWidget
			if strictDashboardJSON(rawWidget, &widget) != nil {
				return fmt.Errorf("invalid module configuration")
			}
			if err := validateDashboardWidget(widget); err != nil {
				return err
			}
		case identity.Version == 2 && slices.Contains(catalogWidgetTypes, identity.Type):
			var widget catalogWidget
			if strictDashboardJSON(rawWidget, &widget) != nil {
				return fmt.Errorf("invalid module configuration")
			}
			if err := validateCatalogWidget(widget); err != nil {
				return err
			}
		default:
			if !unchangedDashboardWidget(rawWidget, old.Widgets) {
				return fmt.Errorf("unsupported module type or version")
			}
		}
	}
	return validateDashboardGroups(members)
}

type dashboardGroupMember struct{ groupID, moduleType, size string }

// validateDashboardGroups checks tabbed cards: the modules of one group are adjacent, there
// are two or three of them, they share one size, and stat cards never join a group.
func validateDashboardGroups(members []dashboardGroupMember) error {
	closed := map[string]bool{}
	for start := 0; start < len(members); {
		id := members[start].groupID
		end := start + 1
		for end < len(members) && id != "" && members[end].groupID == id {
			end++
		}
		if id != "" {
			if !dashboardID.MatchString(id) || closed[id] {
				return fmt.Errorf("a tabbed card must keep its modules together")
			}
			closed[id] = true
			if count := end - start; count < 2 || count > MaxDashboardGroupTabs {
				return fmt.Errorf("a tabbed card holds two or three modules")
			}
			for _, member := range members[start:end] {
				if member.moduleType == "stat" || member.size != members[start].size {
					return fmt.Errorf("tabbed cards combine charts and tables of one size")
				}
			}
		}
		start = end
	}
	return nil
}

var classicWidgetTypes = []string{"stat", "timeseries", "breakdown", "top-issues"}

// Catalog modules are version 2 so a rolling deploy stays safe in both directions: an
// older API pod treats them as an unknown version and keeps them verbatim instead of
// rejecting the whole save, and an older Console hides them without dropping them.
var catalogWidgetTypes = []string{"stat", "timeseries", "breakdown", "ranked-table", "metric-table"}

type catalogWidget struct {
	ID             string          `json:"id"`
	Type           string          `json:"type"`
	Version        int             `json:"version"`
	Title          string          `json:"title"`
	Size           string          `json:"size"`
	View           string          `json:"view"`
	StatAppearance json.RawMessage `json:"statAppearance,omitempty"`
	GroupID        string          `json:"groupId,omitempty"`
	Data           struct {
		Source      string   `json:"source"`
		Metrics     []string `json:"metrics"`
		Dimension   string   `json:"dimension,omitempty"`
		Measurement string   `json:"measurement,omitempty"`
		Filters     struct {
			Release   string `json:"release,omitempty"`
			Route     string `json:"route,omitempty"`
			Country   string `json:"country,omitempty"`
			Browser   string `json:"browser,omitempty"`
			Device    string `json:"device,omitempty"`
			APIMethod string `json:"apiMethod,omitempty"`
			APIURL    string `json:"apiUrl,omitempty"`
			EventKind string `json:"eventKind,omitempty"`
			EventName string `json:"eventName,omitempty"`
		} `json:"filters"`
		Groups    []string `json:"groups,omitempty"`
		Compare   string   `json:"compare,omitempty"`
		Direction string   `json:"direction,omitempty"`
		TopN      int      `json:"topN,omitempty"`
		Sort      string   `json:"sort,omitempty"`
		Order     string   `json:"order,omitempty"`
		Sparkline bool     `json:"sparkline,omitempty"`
	} `json:"data"`
}

var catalogViews = map[string][]string{
	"stat":         {"number"},
	"timeseries":   {"area", "line", "bar", "stacked-area", "stacked-bar"},
	"breakdown":    {"bar", "table", "donut"},
	"ranked-table": {"table"},
	"metric-table": {"table"},
}

// validateCatalogWidget checks layout rules here and hands the data question to the same
// catalog.Validate the query endpoint uses, so a module that saves is a module that runs.
func validateCatalogWidget(w catalogWidget) error {
	if !dashboardText(w.Title, 80) || strings.TrimSpace(w.Title) == "" || !slices.Contains([]string{"compact", "third", "half", "full"}, w.Size) {
		return fmt.Errorf("module title or size is invalid")
	}
	if !slices.Contains(catalogViews[w.Type], w.View) {
		return fmt.Errorf("this view is not available for the module type")
	}
	if w.Type == "stat" {
		if w.Size == "full" || w.Size == "third" {
			return fmt.Errorf("stat modules require a compact or half-width number view")
		}
	} else if w.Size == "compact" {
		return fmt.Errorf("chart and table modules require third, half or full width")
	}
	if len(w.StatAppearance) > 0 {
		var appearance string
		// area-right is current; line-right and bar-right are legacy values the Console reads as area-right.
		if w.Type != "stat" || json.Unmarshal(w.StatAppearance, &appearance) != nil || !slices.Contains([]string{"plain", "area-right", "line-right", "bar-right"}, appearance) {
			return fmt.Errorf("invalid stat card appearance")
		}
	}
	d := w.Data
	if d.Source != "catalog" {
		return fmt.Errorf("version 2 modules read the metric catalog")
	}
	if d.Compare != "" && d.Compare != "previous" {
		return fmt.Errorf("compare must be previous or empty")
	}
	if d.Direction != "" && d.Direction != "up" && d.Direction != "down" {
		return fmt.Errorf("direction must be up, down or empty")
	}
	switch w.Type {
	case "stat", "ranked-table":
		if len(d.Metrics) != 1 {
			return fmt.Errorf("this module shows exactly one metric")
		}
	}
	shape, stack, err := catalog.ShapeForWidget(w.Type, w.View, d.Dimension)
	if err != nil {
		return catalogReason(err)
	}
	spec := catalog.Spec{
		Metrics: d.Metrics, Shape: shape, Dimension: d.Dimension, Measurement: d.Measurement,
		Filters: map[string]string{
			"release": d.Filters.Release, "route": d.Filters.Route, "country": d.Filters.Country,
			"browser": d.Filters.Browser, "device": d.Filters.Device, "apiMethod": d.Filters.APIMethod,
			"apiUrl": d.Filters.APIURL, "eventKind": d.Filters.EventKind, "eventName": d.Filters.EventName,
		},
		Groups:  d.Groups,
		Compare: d.Compare == "previous", TopN: d.TopN, Sort: d.Sort, Order: d.Order,
		Sparkline: d.Sparkline, Stack: stack,
	}
	// Validate the query the Console will actually send: a stat always carries its
	// comparison, and a ranked table always carries its change and sparkline.
	switch w.Type {
	case "stat":
		spec.Compare = true
	case "ranked-table":
		spec.Compare, spec.Sparkline = true, true
	}
	validated, err := catalog.Validate(spec)
	if err != nil {
		return catalogReason(err)
	}
	// A donut draws parts of a whole; rates, percentiles and distinct counts are not.
	if w.View == "donut" {
		metric, _ := catalog.Lookup(validated.Metrics[0])
		if !metric.AdditiveOver(validated.Dimension) {
			return fmt.Errorf("a donut needs a metric that adds up across the dimension")
		}
	}
	return nil
}

func catalogReason(err error) error {
	if errors.Is(err, catalog.ErrInvalidSpec) {
		return errors.New(strings.TrimPrefix(err.Error(), catalog.ErrInvalidSpec.Error()+": "))
	}
	return err
}

func validateDashboardWidget(w dashboardWidget) error {
	if len(w.StatAppearance) > 0 {
		var appearance string
		// Retain legacy bottom variants for existing records and rolling upgrades.
		if w.Type != "stat" || json.Unmarshal(w.StatAppearance, &appearance) != nil || !slices.Contains([]string{"plain", "area-right", "line-right", "bar-right", "line-bottom", "area-bottom"}, appearance) {
			return fmt.Errorf("invalid stat card appearance")
		}
	}
	if !dashboardText(w.Title, 80) || strings.TrimSpace(w.Title) == "" || !slices.Contains([]string{"compact", "third", "half", "full"}, w.Size) {
		return fmt.Errorf("module title or size is invalid")
	}
	if w.Type == "stat" {
		if w.Size == "full" || w.Size == "third" || w.View != "number" {
			return fmt.Errorf("stat modules require a compact or half-width number view")
		}
	} else if w.Size == "compact" {
		return fmt.Errorf("chart and list modules require third, half or full width")
	}
	switch w.Type {
	case "timeseries":
		if !slices.Contains([]string{"area", "line", "bar"}, w.View) {
			return fmt.Errorf("invalid time-series view")
		}
	case "breakdown":
		// The world map view was retired; the Console reads a saved one as ranked bars.
		if w.Data.Source != "events" || !slices.Contains([]string{"bar", "table", "donut"}, w.View) {
			return fmt.Errorf("distributions require event data and a bar, table or donut view")
		}
	case "top-issues":
		if w.Data.Source != "overview" || w.View != "table" || len(w.Data.Metrics) != 0 {
			return fmt.Errorf("invalid list configuration")
		}
	}
	d := w.Data
	if d.Metrics == nil {
		return fmt.Errorf("a metrics array is required")
	}
	if !dashboardText(d.Release, 128) || !dashboardText(d.Route, 512) || !dashboardText(d.EventName, 80) {
		return fmt.Errorf("data filters exceed their bounds")
	}
	if d.Source == "overview" {
		if d.EventKind != "" || d.EventName != "" || d.Dimension != "" {
			return fmt.Errorf("overview does not support event filters")
		}
	} else if d.Source == "events" {
		if d.Release != "" || d.Route != "" {
			return fmt.Errorf("events do not support release or route filters")
		}
		if !slices.Contains([]string{"", "page_view", "navigation", "click", "custom"}, d.EventKind) {
			return fmt.Errorf("invalid event kind")
		}
		if !slices.Contains([]string{"country", "device", "browser", "source"}, d.Dimension) && !dashboardProperty.MatchString(d.Dimension) {
			return fmt.Errorf("invalid event dimension")
		}
	} else {
		return fmt.Errorf("unsupported data source")
	}
	if w.Type == "top-issues" {
		return nil
	}
	if len(d.Metrics) < 1 || len(d.Metrics) > 2 || ((w.Type == "stat" || w.Type == "breakdown") && len(d.Metrics) != 1) {
		return fmt.Errorf("invalid metric selection")
	}
	if len(d.Metrics) == 2 {
		if d.Source != "overview" || !((d.Metrics[0] == "pageViews" && d.Metrics[1] == "uniqueUsers") || (d.Metrics[0] == "errorRate" && d.Metrics[1] == "apiFailureRate")) {
			return fmt.Errorf("only traffic and stability metric pairs can share a chart")
		}
	}
	allowed := []string{"pageViews", "uniqueUsers", "errorRate", "apiFailureRate", "lcp", "inp", "cls"}
	if d.Source == "events" {
		allowed = []string{"estimated", "uniqueUsers", "uniqueSessions"}
	}
	for _, metric := range d.Metrics {
		if !slices.Contains(allowed, metric) {
			return fmt.Errorf("unsupported metric")
		}
	}
	return nil
}

func dashboardText(value string, limit int) bool {
	return utf8.RuneCountInString(value) <= limit && !strings.ContainsAny(value, "\x00\r\n")
}

func strictDashboardJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("unexpected trailing JSON")
	}
	return nil
}

func unchangedDashboardWidget(raw json.RawMessage, previous []json.RawMessage) bool {
	var current any
	if json.Unmarshal(raw, &current) != nil {
		return false
	}
	for _, entry := range previous {
		var old any
		if json.Unmarshal(entry, &old) == nil && reflect.DeepEqual(current, old) {
			return true
		}
	}
	return false
}
