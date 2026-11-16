import type { AlertNotification, AlertRule, NotificationChannel } from "@/lib/api/alerts";

import { environmentLabel } from "@/lib/projects/environments";

export type RuleFilter = "all" | "enabled" | "disabled" | "breached" | "failed" | "attention";
export function filterRules(
  rules: AlertRule[],
  search: string,
  filter: RuleFilter,
  attention?: ReadonlyMap<string, RuleAttention>,
) {
  const needle = search.trim().toLocaleLowerCase();
  return rules.filter((rule) => {
    const matches =
      !needle ||
      `${rule.name} ${rule.environment} ${environmentLabel(rule.environment)}`
        .toLocaleLowerCase()
        .includes(needle);
    return (
      matches &&
      (filter === "all" ||
        (filter === "attention" && needsAction(attention?.get(rule.id))) ||
        (filter === "enabled" && rule.enabled) ||
        (filter === "disabled" && !rule.enabled) ||
        (rule.enabled &&
          (filter === "failed"
            ? rule.lastStatus === "failed"
            : filter === "breached" && ["breached", "suppressed"].includes(rule.lastStatus))))
    );
  });
}
export function notificationTargets(
  rule: Pick<AlertRule, "channelIds">,
  channels: NotificationChannel[],
  available = true,
) {
  if (!rule.channelIds.length) return { label: "仅控制台记录", warning: false };
  if (!available) return { label: "渠道信息暂不可用", warning: true };
  const selected = channels.filter((channel) => rule.channelIds.includes(channel.id));
  const enabled = selected.filter((channel) => channel.enabled);
  if (!enabled.length) return { label: "无可用通知渠道", warning: true };
  return {
    label: enabled.map((channel) => channel.name).join("、"),
    warning: enabled.length !== rule.channelIds.length,
  };
}
export function recentRuleNotifications(notifications: AlertNotification[], ruleId: string) {
  return notifications
    .filter((item) => item.ruleId === ruleId)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

/** The API returns this many of the newest notifications; older ones are not loaded. */
export const NOTIFICATION_LIMIT = 100;
const DAY = 86_400_000;

/** Why an enabled rule deserves a look, most urgent first. */
export type RuleAttention = "breached" | "delivery_failed" | "eval_failed" | "no_channel";
const attentionRank: Record<RuleAttention, number> = {
  breached: 0,
  delivery_failed: 1,
  eval_failed: 2,
  no_channel: 3,
};
/** A breach is shown as such; the rest are problems with the rule or its delivery. */
export function needsAction(reason: RuleAttention | undefined) {
  return Boolean(reason) && reason !== "breached";
}

export function latestRuleNotification(notifications: AlertNotification[], ruleId: string) {
  let latest: AlertNotification | undefined;
  for (const item of notifications)
    if (
      item.ruleId === ruleId &&
      (!latest || Date.parse(item.occurredAt) > Date.parse(latest.occurredAt))
    )
      latest = item;
  return latest;
}

const deliveryFailed = (item: AlertNotification) =>
  item.delivery === "failed" || item.delivery === "partial";

/** The most urgent reason per enabled rule; paused rules and healthy rules have none. */
export function ruleAttentions(
  rules: AlertRule[],
  notifications: AlertNotification[],
  channels: NotificationChannel[],
  channelsAvailable: boolean,
  now = Date.now(),
) {
  const result = new Map<string, RuleAttention>();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const last = latestRuleNotification(notifications, rule.id);
    const recentFailure = last && deliveryFailed(last) && now - Date.parse(last.occurredAt) < DAY;
    if (rule.lastStatus === "breached" || rule.lastStatus === "suppressed")
      result.set(rule.id, "breached");
    else if (recentFailure) result.set(rule.id, "delivery_failed");
    else if (rule.lastStatus === "failed") result.set(rule.id, "eval_failed");
    else if (notificationTargets(rule, channels, channelsAvailable).warning && channelsAvailable)
      result.set(rule.id, "no_channel");
  }
  return result;
}

/** Rules with something to look at first, then healthy ones, then paused ones. */
export function rankRules(rules: AlertRule[], attention: ReadonlyMap<string, RuleAttention>) {
  const rank = (rule: AlertRule) => {
    const reason = attention.get(rule.id);
    if (reason) return attentionRank[reason];
    return rule.enabled ? 10 : 20;
  };
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => rank(a.rule) - rank(b.rule) || a.index - b.index)
    .map((item) => item.rule);
}

export type AlertOverview = {
  breaching: AlertRule[];
  triggers: number;
  /** The newest records were cut off inside the window, so `triggers` is a lower bound. */
  triggersTruncated: boolean;
  /** Triggers in the 24 hours before that; null when the loaded records do not reach back. */
  previousTriggers: number | null;
  deliveryFailures: number;
  failedRuleNames: string[];
  needAction: { rule: AlertRule; reason: RuleAttention }[];
};

export function alertOverview(
  rules: AlertRule[],
  notifications: AlertNotification[],
  attention: ReadonlyMap<string, RuleAttention>,
  now = Date.now(),
): AlertOverview {
  const age = (item: AlertNotification) => now - Date.parse(item.occurredAt);
  const recent = notifications.filter((item) => age(item) < DAY);
  const oldest = notifications.reduce(
    (min, item) => Math.min(min, Date.parse(item.occurredAt)),
    now,
  );
  const covered = notifications.length < NOTIFICATION_LIMIT || now - oldest >= 2 * DAY;
  const names = new Map(rules.map((rule) => [rule.id, rule.name]));
  const failed = recent.filter(deliveryFailed);
  return {
    breaching: rules.filter((rule) => attention.get(rule.id) === "breached"),
    triggers: recent.length,
    triggersTruncated: notifications.length >= NOTIFICATION_LIMIT && now - oldest < DAY,
    previousTriggers: covered
      ? notifications.filter((item) => age(item) >= DAY && age(item) < 2 * DAY).length
      : null,
    deliveryFailures: failed.length,
    failedRuleNames: [...new Set(failed.map((item) => names.get(item.ruleId) ?? item.title))],
    needAction: rules.flatMap((rule) => {
      const reason = attention.get(rule.id);
      return reason && needsAction(reason) ? [{ rule, reason }] : [];
    }),
  };
}

export function formatRelativeTime(iso: string, now = Date.now()) {
  const at = Date.parse(iso);
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(at).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
