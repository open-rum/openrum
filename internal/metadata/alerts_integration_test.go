//go:build integration

package metadata

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	secure "openrum/internal/crypto"
	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestAlertRulesChannelsAndDeliveries(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.PostgresUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	reset := "TRUNCATE audit_logs, alert_deliveries, alert_evaluations, alert_rule_channels, alert_rules, notification_channels, projects, organization_members, organizations, users CASCADE"
	if _, err := database.ExecContext(ctx, reset); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = database.ExecContext(context.WithoutCancel(ctx), reset) }()

	owner, member, outsider := uuid.New(), uuid.New(), uuid.New()
	orgA, orgB, project := uuid.New(), uuid.New(), uuid.New()
	for _, user := range []uuid.UUID{owner, member, outsider} {
		email := user.String() + "@example.com"
		if _, err := database.ExecContext(ctx, "INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,$3,'hash')",
			user, email, email); err != nil {
			t.Fatal(err)
		}
	}
	mustExec := func(query string, arguments ...any) {
		t.Helper()
		if _, err := database.ExecContext(ctx, query, arguments...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec("INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'A','alerts-a',$2),($3,'B','alerts-b',$4)", orgA, owner, orgB, outsider)
	mustExec("INSERT INTO organization_members (organization_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')",
		orgA, owner, member, orgB, outsider)
	mustExec("INSERT INTO projects (id,organization_id,name,slug) VALUES ($1,$2,'Web','web')", project, orgA)

	keyring, err := secure.NewKeyring("k1", secure.Key{ID: "k1", Material: bytes.Repeat([]byte{9}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	alerts := NewAlertRepository(database, keyring)
	feishu, err := alerts.CreateChannel(ctx, owner, orgA, "飞书·前端值班", ChannelFeishu,
		json.RawMessage(`{"webhookUrl":"https://open.feishu.cn/open-apis/bot/v2/hook/abc","secret":"s3cret"}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := alerts.CreateChannel(ctx, member, orgA, "Member channel", ChannelFeishu, json.RawMessage(`{"webhookUrl":"x"}`)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("members must not manage channels: %v", err)
	}
	if _, err := alerts.CreateChannel(ctx, owner, orgA, "Mail", ChannelSMTP, json.RawMessage(`{"host":"x"}`)); !errors.Is(err, ErrInvalidAlertConfig) {
		t.Fatalf("SMTP has no delivery and must not be creatable: %v", err)
	}
	foreign, err := alerts.CreateChannel(ctx, outsider, orgB, "Other org", ChannelWebhook, json.RawMessage(`{"url":"https://hooks.example.com/b","secret":"0123456789abcdef"}`))
	if err != nil {
		t.Fatal(err)
	}

	input := CreateAlertRuleInput{Name: "错误率过高", Metric: AlertErrorRate, Comparator: "gte", Threshold: 2,
		WindowMinutes: 5, CooldownMinutes: 30, Environment: "production", Enabled: true, ChannelIDs: []uuid.UUID{feishu.ID}}
	rule, err := alerts.CreateRule(ctx, member, project, input)
	if err != nil || len(rule.ChannelIDs) != 1 || rule.ChannelIDs[0] != feishu.ID {
		t.Fatalf("members manage rules and route them to their organization's channels: %+v %v", rule, err)
	}
	input.Name, input.ChannelIDs = "跨组织", []uuid.UUID{foreign.ID}
	if _, err := alerts.CreateRule(ctx, owner, project, input); !errors.Is(err, ErrInvalidAlertConfig) {
		t.Fatalf("a rule must never notify another organization's channel: %v", err)
	}

	disabled, empty, threshold := false, []uuid.UUID{}, 5.0
	updated, err := alerts.UpdateRule(ctx, member, project, rule.ID, UpdateAlertRuleInput{Enabled: &disabled, Threshold: &threshold})
	if err != nil || updated.Enabled || updated.Threshold != 5 || len(updated.ChannelIDs) != 1 {
		t.Fatalf("a partial update keeps the channels it does not mention: %+v %v", updated, err)
	}
	badWindow := int16(7)
	if _, err := alerts.UpdateRule(ctx, owner, project, rule.ID, UpdateAlertRuleInput{WindowMinutes: &badWindow}); !errors.Is(err, ErrInvalidAlertConfig) {
		t.Fatalf("an invalid window must be rejected: %v", err)
	}

	channels, err := alerts.ListChannels(ctx, owner, orgA)
	if err != nil || len(channels) != 1 || channels[0].RuleCount != 1 {
		t.Fatalf("channels=%+v err=%v", channels, err)
	}

	// A breach delivered to Feishu after one failed attempt.
	evaluation := uuid.New()
	end := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	mustExec(`INSERT INTO alert_evaluations (id,rule_id,window_started_at,window_ended_at,value,status,notified_at)
		VALUES ($1,$2,$3,$4,3.5,'breached',$4)`, evaluation, rule.ID, end.Add(-5*time.Minute), end)
	mustExec(`INSERT INTO alert_deliveries (evaluation_id,rule_id,channel_id,kind,status,error_code,created_at)
		VALUES ($1,$2,$3,'alert','failed','feishu_rate_limited',$4),($1,$2,$3,'alert','sent','',$5)`,
		evaluation, rule.ID, feishu.ID, end, end.Add(time.Minute))
	notifications, err := alerts.ListNotifications(ctx, owner, project, 20)
	if err != nil || len(notifications) != 1 {
		t.Fatalf("notifications=%+v err=%v", notifications, err)
	}
	delivery := notifications[0].Deliveries
	if len(delivery) != 1 || delivery[0].Status != "sent" || delivery[0].Attempts != 2 || delivery[0].ChannelName != "飞书·前端值班" {
		t.Fatalf("the latest outcome per channel carries the attempt count: %+v", delivery)
	}
	rules, _, err := alerts.ListRules(ctx, owner, project)
	if err != nil || rules[0].LastStatus != "breached" || rules[0].LastEvaluatedAt == nil {
		t.Fatalf("rules=%+v err=%v", rules, err)
	}

	// Editing a channel keeps its secret when none is sent, and members cannot open it.
	if _, _, err := alerts.OpenManagedChannel(ctx, member, orgA, feishu.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("members must not read channel configs: %v", err)
	}
	name := "飞书·告警群"
	if _, err := alerts.UpdateChannel(ctx, owner, orgA, feishu.ID, UpdateChannelInput{Name: &name,
		Config: json.RawMessage(`{"webhookUrl":"https://open.feishu.cn/open-apis/bot/v2/hook/def","secret":"s3cret"}`)}); err != nil {
		t.Fatal(err)
	}
	opened, config, err := alerts.OpenManagedChannel(ctx, owner, orgA, feishu.ID)
	if err != nil || opened.Name != name || config["webhookUrl"] != "https://open.feishu.cn/open-apis/bot/v2/hook/def" || config["secret"] != "s3cret" {
		t.Fatalf("opened=%+v config=%v err=%v", opened, config, err)
	}
	if _, err := alerts.UpdateChannel(ctx, owner, orgB, feishu.ID, UpdateChannelInput{Name: &name}); err == nil {
		t.Fatal("a channel is only reachable through its own organization")
	}
	if err := alerts.RecordTestDelivery(ctx, owner, orgA, feishu.ID, errors.New("sign"), "feishu_sign_invalid"); err != nil {
		t.Fatal(err)
	}

	// Deleting the channel unlinks it from the rule and drops its delivery log.
	if err := alerts.DeleteChannel(ctx, owner, orgA, feishu.ID); err != nil {
		t.Fatal(err)
	}
	var links, deliveries int
	_ = database.QueryRowContext(ctx, "SELECT count(*) FROM alert_rule_channels WHERE rule_id=$1", rule.ID).Scan(&links)
	_ = database.QueryRowContext(ctx, "SELECT count(*) FROM alert_deliveries WHERE channel_id=$1", feishu.ID).Scan(&deliveries)
	if links != 0 || deliveries != 0 {
		t.Fatalf("links=%d deliveries=%d", links, deliveries)
	}
	if _, err := alerts.UpdateRule(ctx, owner, project, rule.ID, UpdateAlertRuleInput{ChannelIDs: &empty}); err != nil {
		t.Fatal(err)
	}
	if err := alerts.DeleteRule(ctx, member, project, rule.ID); err != nil {
		t.Fatal(err)
	}
	var evaluations int
	_ = database.QueryRowContext(ctx, "SELECT count(*) FROM alert_evaluations WHERE rule_id=$1", rule.ID).Scan(&evaluations)
	if evaluations != 0 {
		t.Fatalf("deleting a rule removes its history: %d", evaluations)
	}
	var audited int
	_ = database.QueryRowContext(ctx, `SELECT count(*) FROM audit_logs WHERE action IN
		('alert_rule.updated','alert_rule.deleted','notification_channel.updated','notification_channel.deleted','notification_channel.tested')`).Scan(&audited)
	if audited < 5 {
		t.Fatalf("write actions are audited: %d", audited)
	}
}
