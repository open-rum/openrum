package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/google/uuid"

	"openrum/internal/auth"
	"openrum/internal/metadata"
	"openrum/internal/migrate"
)

const (
	demoEmail    = "demo@openrum.local"
	demoPassword = "OpenRUM-demo-2026!"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	postgres, err := metadata.OpenPostgres(ctx, required("POSTGRES_DSN"))
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = postgres.Close() }()

	clickhouse, err := migrate.OpenClickHouse(required("CLICKHOUSE_DSN"))
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = clickhouse.Close() }()

	projectID, writeKey, err := ensureDemoControlPlane(ctx, postgres)
	if err != nil {
		log.Fatal(err)
	}
	if projectID == uuid.Nil {
		log.Print("OpenRUM is already initialized by another owner; demo seeding was skipped")
		return
	}
	if err := ensureDemoEvents(ctx, clickhouse, projectID); err != nil {
		log.Fatal(err)
	}
	if err := ensureRealisticDemoEvents(ctx, clickhouse, projectID); err != nil {
		log.Fatal(err)
	}

	fmt.Printf("OpenRUM demo ready\nemail: %s\npassword: %s\nproject: %s\n", demoEmail, demoPassword, projectID)
	if writeKey != "" {
		fmt.Printf("public write key: %s\n", writeKey)
	}
}

func ensureDemoControlPlane(ctx context.Context, database *sql.DB) (uuid.UUID, string, error) {
	bootstrapper := auth.NewBootstrapper(database, "")
	initialized, err := bootstrapper.Status(ctx)
	if err != nil {
		return uuid.Nil, "", err
	}
	var userID, organizationID uuid.UUID
	if !initialized {
		result, err := bootstrapper.Bootstrap(ctx, auth.BootstrapInput{
			Email: demoEmail, DisplayName: "OpenRUM Demo", Password: demoPassword,
			OrganizationName: "OpenRUM Demo",
		}, "")
		if err != nil {
			return uuid.Nil, "", err
		}
		userID, organizationID = result.UserID, result.OrganizationID
	} else {
		err := database.QueryRowContext(ctx, `SELECT users.id, organization_members.organization_id
			FROM users JOIN organization_members ON organization_members.user_id=users.id
			WHERE users.email=$1 ORDER BY organization_members.created_at LIMIT 1`, demoEmail).Scan(&userID, &organizationID)
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, "", nil
		}
		if err != nil {
			return uuid.Nil, "", err
		}
	}
	if err := ensureDemoInstanceOwner(ctx, database, userID); err != nil {
		return uuid.Nil, "", err
	}

	var projectID uuid.UUID
	err = database.QueryRowContext(ctx, `SELECT id FROM projects
		WHERE organization_id=$1 AND slug IN ('demo-storefront','demo-shop-h5')
		ORDER BY CASE slug WHEN 'demo-shop-h5' THEN 0 ELSE 1 END LIMIT 1`, organizationID).Scan(&projectID)
	if err == nil {
		return projectID, "", nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, "", err
	}
	project, credential, err := metadata.NewProjectRepository(database).CreateWithKey(ctx, userID, metadata.CreateProjectInput{
		OrganizationID:  organizationID,
		Name:            "商城 H5（演示）",
		Slug:            "demo-storefront",
		AllowedOrigins:  []string{"http://localhost:4173", "http://127.0.0.1:4173"},
		Environment:     "production",
		Environments:    []string{"production", "canary", "test", "development"},
		RetentionDays:   14,
		EventSampleRate: 1,
		APISampleRate:   1,
		ErrorSampleRate: 1,
	}, "Demo SDK")
	if err != nil {
		return uuid.Nil, "", err
	}
	return project.ID, credential.Raw, nil
}

func ensureDemoInstanceOwner(ctx context.Context, database *sql.DB, userID uuid.UUID) error {
	_, err := database.ExecContext(ctx, `INSERT INTO instance_members (user_id, role, created_by)
		VALUES ($1, 'instance_owner', $1)
		ON CONFLICT (user_id) DO UPDATE
		SET role='instance_owner', updated_at=now()`, userID)
	return err
}

type demoEvent struct {
	eventType, route, customName, navigation, metricName                string
	apiMethod, apiURL, apiFailure, errorType, errorMessage, fingerprint string
	metricValue, durationMS                                             float64
	apiStatus                                                           uint16
	attributes                                                          map[string]string
	breadcrumbs                                                         []string
}

func ensureDemoEvents(ctx context.Context, database *sql.DB, projectID uuid.UUID) error {
	var count uint64
	if err := database.QueryRowContext(ctx, "SELECT count() FROM rum_events WHERE project_id=? AND attributes['openrum_demo']='true'", projectID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	const insertEvent = `INSERT INTO rum_events
		(project_id,event_id,event_type,timestamp,received_at,environment,release,session_id,anonymous_user_id,page_id,
		page_url,page_url_normalized,route,referrer,title,navigation_type,sdk_name,sdk_version,schema_version,sample_rate,
		browser,browser_version,os,os_version,device_type,country,error_type,error_message,error_stack,fingerprint,
		fingerprint_version,handled,api_method,api_url_normalized,api_status,api_failure,duration_ms,metric_name,metric_value,
		metric_rating,custom_name,attributes,breadcrumbs,ingest_flags)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

	now := time.Now().UTC().Truncate(time.Second)
	errorEventIDs := make([]uuid.UUID, 0, 2)
	for sessionIndex := 0; sessionIndex < 24; sessionIndex++ {
		sessionID, pageID := uuid.New(), uuid.New()
		anonymousID := fmt.Sprintf("demo-user-%02d", sessionIndex%16)
		browser := []string{"Chrome", "Safari", "Edge"}[sessionIndex%3]
		device := []string{"desktop", "mobile"}[sessionIndex%2]
		country := []string{"CN", "US", "SG"}[sessionIndex%3]
		base := now.Add(-time.Duration(25-sessionIndex) * 11 * time.Minute)
		events := []demoEvent{
			{eventType: "page_view", route: "/", navigation: "navigate"},
			{eventType: "page_view", route: "/products/42", navigation: "route_change"},
			{eventType: "custom", route: "/products/42", customName: "ui.click", attributes: map[string]string{"target": "购买按钮", "product": "经典款"}},
		}
		if sessionIndex < 15 {
			events = append(events, demoEvent{eventType: "custom", route: "/checkout", customName: "checkout_started", attributes: map[string]string{"plan": "standard"}})
		}
		if sessionIndex < 9 {
			events = append(events, demoEvent{eventType: "custom", route: "/checkout/success", customName: "order_completed", attributes: map[string]string{"plan": "standard"}})
		}
		if sessionIndex%3 == 0 {
			events = append(events, demoEvent{eventType: "api", route: "/checkout", apiMethod: "POST", apiURL: "/api/orders", apiStatus: 200, durationMS: 310 + float64(sessionIndex*12)})
		}
		if sessionIndex == 4 || sessionIndex == 11 {
			events = append(events, demoEvent{eventType: "api", route: "/checkout", apiMethod: "POST", apiURL: "/api/orders", apiStatus: 503, apiFailure: "http", durationMS: 1380})
			events = append(events, demoEvent{eventType: "error", route: "/checkout", errorType: "CheckoutError", errorMessage: "提交订单失败：库存服务暂时不可用", fingerprint: "v1:demo-checkout", breadcrumbs: []string{"进入商品详情", "点击购买按钮", "POST /api/orders → 503"}})
		}
		for eventIndex, item := range events {
			eventID := uuid.New()
			if item.eventType == "error" {
				errorEventIDs = append(errorEventIDs, eventID)
			}
			attributes := map[string]string{"openrum_demo": "true"}
			for key, value := range item.attributes {
				attributes[key] = value
			}
			stack := ""
			if item.eventType == "error" {
				stack = "CheckoutError: inventory unavailable\n    at submitOrder (https://shop.demo/assets/app.js:1:482)"
			}
			metricRating := ""
			_, err := database.ExecContext(ctx, insertEvent, projectID, eventID, item.eventType, base.Add(time.Duration(eventIndex)*time.Minute), now,
				"production", "web@demo", sessionID, anonymousID, pageID, "https://shop.demo"+item.route, "https://shop.demo"+item.route,
				item.route, "https://search.example/", "OpenRUM Demo Store", item.navigation, "@openrum/browser", "0.1.0", "1", 1,
				browser, "126", "macOS", "15", device, country, item.errorType, item.errorMessage, stack, item.fingerprint, 1, false,
				item.apiMethod, item.apiURL, item.apiStatus, item.apiFailure, item.durationMS, item.metricName, item.metricValue,
				metricRating, item.customName, attributes, item.breadcrumbs, []string{})
			if err != nil {
				return fmt.Errorf("insert demo event: %w", err)
			}
		}
		for _, metric := range []struct {
			name   string
			value  float64
			rating string
		}{{"LCP", 2120 + float64(sessionIndex*18), "needs-improvement"}, {"INP", 148 + float64(sessionIndex), "good"}, {"CLS", .08, "good"}} {
			_, err := database.ExecContext(ctx, insertEvent, projectID, uuid.New(), "web_vital", base.Add(8*time.Minute), now, "production", "web@demo",
				sessionID, anonymousID, pageID, "https://shop.demo/products/42", "https://shop.demo/products/42", "/products/42", "", "Product",
				"", "@openrum/browser", "0.1.0", "1", 1, browser, "126", "macOS", "15", device, country,
				"", "", "", "", 0, false, "", "", 0, "", 0, metric.name, metric.value, metric.rating, "", map[string]string{"openrum_demo": "true"}, []string{}, []string{})
			if err != nil {
				return fmt.Errorf("insert demo vital: %w", err)
			}
		}
	}

	// A small previous-week cohort makes the retention matrix meaningful without exceeding the 14-day Alpha TTL.
	for index := 0; index < 10; index++ {
		identity := fmt.Sprintf("demo-cohort-%02d", index)
		for _, at := range []time.Time{now.Add(-9 * 24 * time.Hour), now.Add(-2 * 24 * time.Hour)} {
			if index >= 6 && at.After(now.Add(-5*24*time.Hour)) {
				continue
			}
			_, err := database.ExecContext(ctx, insertEvent, projectID, uuid.New(), "page_view", at, now, "production", "web@demo", uuid.New(), identity, uuid.New(),
				"https://shop.demo/", "https://shop.demo/", "/", "", "Home", "navigate", "@openrum/browser", "0.1.0", "1", 1,
				"Chrome", "126", "macOS", "15", "desktop", "CN", "", "", "", "", 0, false, "", "", 0, "", 0, "", 0, "", "",
				map[string]string{"openrum_demo": "true"}, []string{}, []string{})
			if err != nil {
				return fmt.Errorf("insert demo cohort: %w", err)
			}
		}
	}

	for _, errorEventID := range errorEventIDs {
		mapped := map[string]any{"raw": "at submitOrder (https://shop.demo/assets/app.js:1:482)", "status": "mapped", "frames": []any{
			map[string]any{"function": "submitOrder", "url": "https://shop.demo/assets/app.js", "line": 1, "column": 482,
				"original": map[string]any{"source": "src/checkout/submit.ts", "function": "submitOrder", "line": 42, "column": 11}},
		}}
		contents, _ := json.Marshal(mapped)
		if _, err := database.ExecContext(ctx, `INSERT INTO event_stack_mappings (project_id,event_id,status,failure_code,mapped_stack,mapped_at) VALUES (?,?,?,?,?,?)`,
			projectID, errorEventID, "mapped", "", string(contents), now); err != nil {
			return err
		}
	}
	return nil
}

func required(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("%s is required", name)
	}
	return value
}
