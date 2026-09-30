import type {
  AlertComparator,
  AlertMetric,
  AlertRule,
  AlertRuleInput,
  DeliveryState,
} from "@/lib/api/alerts";

export type MetricDefinition = {
  label: string;
  description: string;
  unit: "count" | "percent" | "ms";
  unitLabel: string;
  step: number;
};

export const metricDefinitions: Record<AlertMetric, MetricDefinition> = {
  error_count: {
    label: "错误数",
    description: "统计窗口内的错误事件数，按采样率还原",
    unit: "count",
    unitLabel: "次",
    step: 1,
  },
  error_rate: {
    label: "错误率",
    description: "错误事件数占页面浏览量的百分比",
    unit: "percent",
    unitLabel: "%",
    step: 0.1,
  },
  api_failure_rate: {
    label: "API 失败率",
    description: "网络失败和 5xx 响应占全部 API 请求的百分比，不含 4xx",
    unit: "percent",
    unitLabel: "%",
    step: 0.1,
  },
  lcp_p75: {
    label: "LCP P75",
    description: "主要内容加载耗时的 P75，单位毫秒",
    unit: "ms",
    unitLabel: "ms",
    step: 100,
  },
};

export const windowOptions = [5, 10, 15, 30, 60] as const;
export const cooldownOptions = [5, 15, 30, 60, 120, 360, 1440] as const;

export const comparatorLabels: Record<AlertComparator, string> = { gte: "≥", gt: ">" };

export function formatMetricValue(metric: AlertMetric, value: number) {
  const definition = metricDefinitions[metric];
  const rounded = Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  const text = rounded.toLocaleString("zh-CN");
  if (definition.unit === "percent") return `${text}%`;
  if (definition.unit === "ms") return `${text} ms`;
  return text;
}

export function formatDuration(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

/** "错误率 ≥ 2% · 最近 5 分钟" */
export function conditionText(
  rule: Pick<AlertRule, "metric" | "comparator" | "threshold" | "windowMinutes">,
) {
  const definition = metricDefinitions[rule.metric];
  return `${definition.label} ${comparatorLabels[rule.comparator]} ${formatMetricValue(rule.metric, rule.threshold)} · 最近 ${formatDuration(rule.windowMinutes)}`;
}

/** The editor's live sentence, e.g. "当 production 环境最近 5 分钟错误率 ≥ 2% 时，通知 飞书·前端值班群". */
export function ruleSummary(input: AlertRuleInput, channelNames: string[]) {
  const definition = metricDefinitions[input.metric];
  const scope = input.environment ? `${input.environment} 环境` : "所有环境";
  const condition = `${definition.label} ${comparatorLabels[input.comparator]} ${formatMetricValue(input.metric, input.threshold)}`;
  const target = channelNames.length
    ? `通知 ${channelNames.join("、")}`
    : "只在控制台记录，不发送通知";
  return `当${scope}最近 ${formatDuration(input.windowMinutes)}${condition}时，${target}。同一规则 ${formatDuration(input.cooldownMinutes)}内最多通知一次。`;
}

/** Mirrors validAlertRule in internal/metadata/alerts.go. Returns field → message. */
export function validateRule(input: AlertRuleInput): Partial<Record<keyof AlertRuleInput, string>> {
  const errors: Partial<Record<keyof AlertRuleInput, string>> = {};
  const name = input.name.trim();
  if (!name) errors.name = "请填写规则名称。";
  else if (new TextEncoder().encode(name).length > 120) errors.name = "名称过长。";
  if (!Number.isFinite(input.threshold) || input.threshold < 0 || input.threshold >= 1e12)
    errors.threshold = "阈值需为不小于 0 的数字。";
  else if (input.metric === "api_failure_rate" && input.threshold > 100)
    errors.threshold = "API 失败率不会超过 100%。";
  if (!(windowOptions as readonly number[]).includes(input.windowMinutes))
    errors.windowMinutes = "请选择统计窗口。";
  if (input.cooldownMinutes < 5 || input.cooldownMinutes > 1440)
    errors.cooldownMinutes = "冷却时间需在 5 分钟到 1 天之间。";
  if (input.environment && !/^[a-z][a-z0-9_-]{0,63}$/.test(input.environment))
    errors.environment = "环境名称不合法。";
  if (input.channelIds.length > 10) errors.channelIds = "每条规则最多通知 10 个渠道。";
  return errors;
}

export type RuleTemplate = { id: string; description: string; rule: AlertRuleInput };

/** Starting points for a new rule. They prefill the editor; nothing is created until saved. */
export function ruleTemplates(environment: string): RuleTemplate[] {
  const base = { environment, enabled: true, channelIds: [], comparator: "gte" as const };
  return [
    {
      id: "error-rate",
      description: "5 分钟内错误率达到 2%",
      rule: {
        ...base,
        name: "错误率突增",
        metric: "error_rate",
        threshold: 2,
        windowMinutes: 5,
        cooldownMinutes: 30,
      },
    },
    {
      id: "api-failure",
      description: "10 分钟内 API 失败率达到 5%",
      rule: {
        ...base,
        name: "API 失败率过高",
        metric: "api_failure_rate",
        threshold: 5,
        windowMinutes: 10,
        cooldownMinutes: 30,
      },
    },
    {
      id: "lcp",
      description: "15 分钟内 LCP P75 达到 2.5 秒",
      rule: {
        ...base,
        name: "LCP 体验退化",
        metric: "lcp_p75",
        threshold: 2500,
        windowMinutes: 15,
        cooldownMinutes: 60,
      },
    },
  ];
}

export function blankRule(environment: string): AlertRuleInput {
  return {
    name: "",
    metric: "error_rate",
    comparator: "gte",
    threshold: 2,
    windowMinutes: 5,
    cooldownMinutes: 30,
    environment,
    enabled: true,
    channelIds: [],
  };
}

/** A copy's name that does not collide with an existing rule. */
export function copyName(name: string, existing: string[]) {
  const taken = new Set(existing);
  for (let index = 1; index < 100; index++) {
    const candidate = index === 1 ? `${name} 副本` : `${name} 副本 ${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${name} 副本`;
}

export const ruleStatusLabels: Record<
  AlertRule["lastStatus"],
  { label: string; tone: "ok" | "danger" | "muted" | "warning" }
> = {
  "": { label: "尚未评估", tone: "muted" },
  ok: { label: "正常", tone: "ok" },
  breached: { label: "已触发", tone: "danger" },
  suppressed: { label: "冷却中", tone: "warning" },
  failed: { label: "读取失败", tone: "warning" },
};

export const deliveryStateLabels: Record<
  DeliveryState,
  { label: string; tone: "ok" | "danger" | "muted" | "warning" }
> = {
  delivered: { label: "已送达", tone: "ok" },
  partial: { label: "部分失败", tone: "warning" },
  failed: { label: "发送失败", tone: "danger" },
  pending: { label: "发送中", tone: "muted" },
  no_channels: { label: "未配置渠道", tone: "muted" },
  cooldown: { label: "冷却中", tone: "muted" },
};

const errorCodeLabels: Record<string, string> = {
  feishu_sign_invalid: "签名校验失败：检查签名密钥是否与飞书机器人一致",
  feishu_keyword_mismatch: "消息不含机器人设置的关键词：把自定义关键词设为 OpenRUM",
  feishu_ip_not_allowed: "机器人开启了 IP 白名单：加入 OpenRUM 服务器的出口 IP",
  feishu_rate_limited: "触发飞书频率限制：每个机器人每分钟最多 100 条",
  feishu_rejected: "飞书拒绝了这条消息",
  feishu_bad_response: "飞书返回了无法识别的响应",
  network: "网络连接失败",
  timeout: "请求超时",
  unsafe_url: "地址指向内网或不安全的地址，已拦截",
  secrets_unavailable: "实例未配置主密钥，无法解密渠道配置",
  decrypt_failed: "渠道配置无法解密，请重新保存渠道",
  config_invalid: "渠道配置无效，请重新保存渠道",
  kind_unsupported: "这种渠道暂不支持发送",
};

export function deliveryErrorText(code: string | undefined) {
  if (!code) return "发送失败";
  if (errorCodeLabels[code]) return errorCodeLabels[code];
  const http = /^http_(\d{3})$/.exec(code);
  if (http) return `目标地址返回 HTTP ${http[1]}`;
  return "发送失败";
}
