import { describe, expect, it } from "vitest";
import type { AlertRule, NotificationChannel, AlertNotification } from "@/lib/api/alerts";
import { blankRule } from "./alertRules";
import {
  alertOverview,
  filterRules,
  formatRelativeTime,
  notificationTargets,
  rankRules,
  recentRuleNotifications,
  ruleAttentions,
} from "./alertPresentation";
const rule = (id: string, extra: Partial<AlertRule> = {}): AlertRule => ({
  ...blankRule("production"),
  id,
  projectId: "p1",
  name: id,
  lastStatus: "",
  recentStatuses: [],
  ...extra,
});
const channel = (id: string, enabled = true): NotificationChannel => ({
  id,
  name: id,
  enabled,
  organizationId: "o1",
  kind: "feishu",
  ruleCount: 1,
  createdAt: "2026-11-05T00:00:00Z",
});
describe("alert presentation", () => {
  it("separates paused rules from the last threshold result and combines search with state", () => {
    const rules = [
      rule("Checkout", { lastStatus: "breached" }),
      rule("Paused", { enabled: false, lastStatus: "breached" }),
      rule("Read failure", { lastStatus: "failed" }),
    ];
    expect(filterRules(rules, " checkout ", "breached").map((r) => r.id)).toEqual(["Checkout"]);
    expect(filterRules(rules, "", "breached")).toHaveLength(1);
    expect(filterRules(rules, "生产", "breached")).toHaveLength(1);
    expect(filterRules(rules, "production", "failed").map((r) => r.id)).toEqual(["Read failure"]);
  });
  it("does not call unavailable or disabled destinations console-only", () => {
    expect(notificationTargets({ channelIds: [] }, [])).toEqual({
      label: "仅控制台记录",
      warning: false,
    });
    expect(notificationTargets({ channelIds: ["a"] }, [], false)).toEqual({
      label: "渠道信息暂不可用",
      warning: true,
    });
    expect(notificationTargets({ channelIds: ["a"] }, [channel("a", false)])).toEqual({
      label: "无可用通知渠道",
      warning: true,
    });
    expect(
      notificationTargets({ channelIds: ["a", "b"] }, [channel("a"), channel("b", false)]),
    ).toEqual({ label: "a", warning: true });
  });
  it("returns the selected rule's latest notifications first without mutating the source", () => {
    const items = [
      { ruleId: "a", occurredAt: "2026-11-04T00:00:00Z" },
      { ruleId: "b", occurredAt: "2026-11-05T00:00:00Z" },
      { ruleId: "a", occurredAt: "2026-11-05T00:00:00Z" },
    ] as AlertNotification[];
    expect(recentRuleNotifications(items, "a").map((n) => n.occurredAt)).toEqual([
      "2026-11-05T00:00:00Z",
      "2026-11-04T00:00:00Z",
    ]);
    expect(items[0].occurredAt).toBe("2026-11-04T00:00:00Z");
  });
});

describe("alert overview", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const note = (ruleId: string, hours: number, delivery: AlertNotification["delivery"]) =>
    ({
      id: `${ruleId}-${hours}`,
      ruleId,
      title: ruleId,
      occurredAt: hoursAgo(hours),
      delivery,
      deliveries: [],
    }) as unknown as AlertNotification;

  it("ranks breaches, delivery failures, evaluation failures and missing channels, then the rest", () => {
    const rules = [
      rule("paused", { enabled: false, lastStatus: "breached" }),
      rule("healthy", { lastStatus: "ok" }),
      rule("orphan", { lastStatus: "ok", channelIds: ["off"] }),
      rule("broken", { lastStatus: "failed" }),
      rule("undelivered", { lastStatus: "ok" }),
      rule("breaching", { lastStatus: "suppressed" }),
    ];
    const notes = [note("undelivered", 2, "failed")];
    const attention = ruleAttentions(rules, notes, [channel("off", false)], true, now);
    expect([...attention]).toEqual([
      ["orphan", "no_channel"],
      ["broken", "eval_failed"],
      ["undelivered", "delivery_failed"],
      ["breaching", "breached"],
    ]);
    expect(rankRules(rules, attention).map((r) => r.id)).toEqual([
      "breaching",
      "undelivered",
      "broken",
      "orphan",
      "healthy",
      "paused",
    ]);
    // Rules needing action, without the plain breach.
    expect(filterRules(rules, "", "attention", attention).map((r) => r.id)).toEqual([
      "orphan",
      "broken",
      "undelivered",
    ]);
  });

  it("ignores old delivery failures and unknown channels", () => {
    const rules = [rule("a", { lastStatus: "ok", channelIds: ["x"] })];
    expect(ruleAttentions(rules, [note("a", 30, "failed")], [], true, now).size).toBe(1);
    expect(ruleAttentions(rules, [note("a", 30, "failed")], [], false, now).size).toBe(0);
    expect(ruleAttentions(rules, [note("a", 30, "failed")], [channel("x")], true, now).size).toBe(
      0,
    );
  });

  it("counts the last 24 hours against the 24 hours before", () => {
    const rules = [rule("a"), rule("b")];
    const notes = [
      note("a", 1, "delivered"),
      note("a", 5, "failed"),
      note("b", 10, "partial"),
      note("b", 30, "delivered"),
      note("b", 40, "delivered"),
      note("b", 47, "delivered"),
    ];
    const overview = alertOverview(rules, notes, new Map(), now);
    expect(overview.triggers).toBe(3);
    expect(overview.previousTriggers).toBe(3);
    expect(overview.deliveryFailures).toBe(2);
    expect(overview.failedRuleNames).toEqual(["a", "b"]);
    expect(overview.triggersTruncated).toBe(false);
  });

  it("drops the comparison when the loaded records stop inside the window", () => {
    const notes = Array.from({ length: 100 }, (_, index) => note("a", index / 10, "delivered"));
    const overview = alertOverview([rule("a")], notes, new Map(), now);
    expect(overview.triggersTruncated).toBe(true);
    expect(overview.previousTriggers).toBeNull();
  });

  it("writes relative times in Chinese", () => {
    expect(formatRelativeTime(hoursAgo(0), now)).toBe("刚刚");
    expect(formatRelativeTime(new Date(now - 12 * 60_000).toISOString(), now)).toBe("12 分钟前");
    expect(formatRelativeTime(hoursAgo(5), now)).toBe("5 小时前");
    expect(formatRelativeTime(hoursAgo(72), now)).toBe("3 天前");
  });
});
