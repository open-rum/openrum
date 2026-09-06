package handlers

import (
	"context"
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/query"
)

type fakeUsageQueries struct{ result query.UsageResult }

func (fake fakeUsageQueries) Get(context.Context, query.UsageFilters) (query.UsageResult, error) {
	return fake.result, nil
}

func TestUsageCSVIsEscapedAndRequiresProjectAccess(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	bucket := time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC)
	handler := NewUsageHandler(
		fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleViewer}},
		fakeUsageQueries{result: query.UsageResult{Breakdown: []query.UsageBreakdown{{
			Bucket: bucket, EventType: "custom,quoted", Outcome: "accepted", Reason: "=cmd", Events: 2, Estimated: 4.5, Bytes: 100,
		}}}}, zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("GET /api/v1/projects/{projectId}/usage.csv", authenticated(http.HandlerFunc(handler.CSV)))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID.String()+"/usage.csv?from="+bucket.Add(-time.Hour).Format(time.RFC3339Nano)+"&to="+bucket.Add(time.Hour).Format(time.RFC3339Nano), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	rows, err := csv.NewReader(strings.NewReader(response.Body.String())).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || len(rows) != 2 || rows[1][1] != "custom,quoted" || rows[1][3] != "'=cmd" {
		t.Fatalf("status=%d rows=%v body=%s", response.Code, rows, response.Body.String())
	}
	if response.Header().Get("Content-Disposition") != `attachment; filename="openrum-usage.csv"` {
		t.Fatalf("content disposition=%q", response.Header().Get("Content-Disposition"))
	}
}
