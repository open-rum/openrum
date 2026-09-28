//go:build integration

package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/google/uuid"
)

var emptyDashboard = json.RawMessage(`{"schemaVersion":1,"widgets":[]}`)

func TestNamedDashboardsLifecycle(t *testing.T) {
	database := integrationDatabase(t)
	userID, projectID := seedIssueProject(t, database)
	repository := NewDashboardRepository(database)
	ctx := context.Background()

	if list, err := repository.List(ctx, userID, projectID); err != nil || len(list) != 0 {
		t.Fatalf("a new user has no dashboards: %+v %v", list, err)
	}
	traffic, err := repository.Create(ctx, userID, projectID, "  流量  ", emptyDashboard)
	if err != nil || traffic.Name != "流量" || traffic.Position != 0 || traffic.Revision != 1 {
		t.Fatalf("create trims the name and starts at position 0: %+v %v", traffic, err)
	}
	api, err := repository.Create(ctx, userID, projectID, "API", emptyDashboard)
	if err != nil || api.Position != 1 {
		t.Fatalf("the next dashboard goes last: %+v %v", api, err)
	}
	if _, err := repository.Create(ctx, userID, projectID, "api", emptyDashboard); !errors.Is(err, ErrDashboardNameTaken) {
		t.Fatalf("names are unique regardless of case: %v", err)
	}
	if _, err := repository.Create(ctx, userID, projectID, "   ", emptyDashboard); !errors.Is(err, ErrInvalidDashboardName) {
		t.Fatalf("a blank name is rejected before the database: %v", err)
	}

	withModule := json.RawMessage(`{"schemaVersion":1,"widgets":[{"id":"x","type":"future","version":9}]}`)
	saved, err := repository.SaveConfig(ctx, userID, projectID, traffic.ID, withModule, 1)
	if err != nil || saved.Revision != 2 {
		t.Fatalf("saving advances the revision: %+v %v", saved, err)
	}
	if _, err := repository.SaveConfig(ctx, userID, projectID, traffic.ID, emptyDashboard, 1); !errors.Is(err, ErrConfigVersionConflict) {
		t.Fatalf("a stale revision is a conflict: %v", err)
	}
	renamed, err := repository.Rename(ctx, userID, projectID, traffic.ID, "流量与会话")
	if err != nil || renamed.Revision != 2 {
		t.Fatalf("renaming must not advance the revision another tab is editing against: %+v %v", renamed, err)
	}

	copied, err := repository.Duplicate(ctx, userID, projectID, traffic.ID, "流量副本")
	if err != nil || copied.Position != 2 {
		t.Fatalf("duplicate: %+v %v", copied, err)
	}
	var original, duplicate any
	_ = json.Unmarshal(saved.Config, &original)
	_ = json.Unmarshal(copied.Config, &duplicate)
	if fmt.Sprint(original) != fmt.Sprint(duplicate) {
		t.Fatalf("a duplicate keeps modules this deployment cannot read: %s vs %s", saved.Config, copied.Config)
	}

	reordered, err := repository.Reorder(ctx, userID, projectID, []uuid.UUID{copied.ID, traffic.ID, api.ID})
	if err != nil || reordered[0].ID != copied.ID || reordered[2].ID != api.ID || reordered[0].WidgetCount != 1 {
		t.Fatalf("reorder: %+v %v", reordered, err)
	}
	if _, err := repository.Reorder(ctx, userID, projectID, []uuid.UUID{copied.ID, traffic.ID}); !errors.Is(err, ErrDashboardOrderStale) {
		t.Fatalf("an order missing a dashboard is stale: %v", err)
	}
	if _, err := repository.Reorder(ctx, userID, projectID, []uuid.UUID{copied.ID, copied.ID, api.ID}); !errors.Is(err, ErrDashboardOrderStale) {
		t.Fatalf("an order repeating a dashboard is stale: %v", err)
	}

	if err := repository.Delete(ctx, userID, projectID, traffic.ID); err != nil {
		t.Fatal(err)
	}
	remaining, _ := repository.List(ctx, userID, projectID)
	if len(remaining) != 2 || remaining[0].Position != 0 || remaining[1].Position != 1 || remaining[1].ID != api.ID {
		t.Fatalf("deleting closes the gap: %+v", remaining)
	}
	if err := repository.Delete(ctx, userID, projectID, traffic.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleting twice: %v", err)
	}
	for _, current := range remaining {
		if err := repository.Delete(ctx, userID, projectID, current.ID); err != nil {
			t.Fatal(err)
		}
	}
	if list, _ := repository.List(ctx, userID, projectID); len(list) != 0 {
		t.Fatal("the last dashboard can be deleted: the user is back to the built-in layout")
	}
}

func TestNamedDashboardsAreLimitedEvenUnderConcurrentCreates(t *testing.T) {
	database := integrationDatabase(t)
	userID, projectID := seedIssueProject(t, database)
	repository := NewDashboardRepository(database)
	ctx := context.Background()
	for index := range MaxDashboards - 2 {
		if _, err := repository.Create(ctx, userID, projectID, fmt.Sprintf("看板 %d", index), emptyDashboard); err != nil {
			t.Fatal(err)
		}
	}
	var wait sync.WaitGroup
	results := make([]error, 5)
	for index := range results {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, results[index] = repository.Create(ctx, userID, projectID, fmt.Sprintf("并发 %d", index), emptyDashboard)
		}()
	}
	wait.Wait()
	succeeded, limited := 0, 0
	for _, err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrDashboardLimitReached):
			limited++
		default:
			t.Fatalf("concurrent creates must serialize, not collide: %v", err)
		}
	}
	if succeeded != 2 || limited != 3 {
		t.Fatalf("exactly two of five fit under the limit: ok=%d limited=%d", succeeded, limited)
	}
	list, _ := repository.List(ctx, userID, projectID)
	for index, current := range list {
		if current.Position != index {
			t.Fatalf("positions stay dense: %+v", list)
		}
	}
}

func TestNamedDashboardsAreIsolatedAndGatedByMembership(t *testing.T) {
	database := integrationDatabase(t)
	ownerID, projectID := seedIssueProject(t, database)
	strangerID, strangerProject := seedIssueProject(t, database)
	repository := NewDashboardRepository(database)
	ctx := context.Background()
	mine, err := repository.Create(ctx, ownerID, projectID, "我的", emptyDashboard)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.GetByID(ctx, strangerID, strangerProject, mine.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another user's dashboard id reads as not found: %v", err)
	}
	if _, err := repository.Create(ctx, strangerID, projectID, "闯入", emptyDashboard); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a non-member cannot create in someone else's project: %v", err)
	}
	if _, err := repository.Rename(ctx, strangerID, strangerProject, mine.ID, "改名"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a non-member cannot rename it: %v", err)
	}
	if _, err := database.ExecContext(ctx, "UPDATE projects SET status='deleting' WHERE id=$1", projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.SaveConfig(ctx, ownerID, projectID, mine.ID, emptyDashboard, 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a Project being deleted accepts no writes: %v", err)
	}
}

func TestLegacyDashboardEndpointMapsToTheFirstDashboard(t *testing.T) {
	database := integrationDatabase(t)
	userID, projectID := seedIssueProject(t, database)
	repository := NewDashboardRepository(database)
	ctx := context.Background()
	if current, err := repository.Get(ctx, userID, projectID); err != nil || current.Config != nil || current.Revision != 0 {
		t.Fatalf("no dashboard reads as the empty legacy document: %+v %v", current, err)
	}
	created, err := repository.Save(ctx, userID, projectID, emptyDashboard, 0)
	if err != nil || created.Revision != 1 {
		t.Fatalf("revision zero creates the first dashboard: %+v %v", created, err)
	}
	list, _ := repository.List(ctx, userID, projectID)
	if len(list) != 1 || list[0].Name != DefaultDashboardName {
		t.Fatalf("it is named like the built-in layout: %+v", list)
	}
	if _, err := repository.Save(ctx, userID, projectID, emptyDashboard, 0); !errors.Is(err, ErrConfigVersionConflict) {
		t.Fatalf("revision zero never overwrites an existing dashboard: %v", err)
	}
	saved, err := repository.Save(ctx, userID, projectID, emptyDashboard, 1)
	if err != nil || saved.Revision != 2 {
		t.Fatalf("a later revision saves the first dashboard: %+v %v", saved, err)
	}
}
