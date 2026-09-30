import { z } from "zod";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON } from "./client";

const iso = z.iso.datetime({ offset: true });

export const alertMetrics = ["error_count", "error_rate", "api_failure_rate", "lcp_p75"] as const;
export type AlertMetric = (typeof alertMetrics)[number];
export const alertComparators = ["gte", "gt"] as const;
export type AlertComparator = (typeof alertComparators)[number];
/** Channel kinds the server can store today; others appear in the Console as coming soon. */
export const storedChannelKinds = ["webhook", "feishu", "smtp"] as const;
export type StoredChannelKind = (typeof storedChannelKinds)[number];

const ruleSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  metric: z.enum(alertMetrics),
  comparator: z.enum(alertComparators),
  threshold: z.number(),
  windowMinutes: z.number().int(),
  cooldownMinutes: z.number().int(),
  environment: z.string(),
  enabled: z.boolean(),
  channelIds: z.array(z.string()).default([]),
  lastStatus: z.enum(["", "ok", "breached", "suppressed", "failed"]).catch(""),
  lastEvaluatedAt: iso.optional(),
});
export type AlertRule = z.infer<typeof ruleSchema>;
export type AlertRuleInput = Pick<
  AlertRule,
  | "name"
  | "metric"
  | "comparator"
  | "threshold"
  | "windowMinutes"
  | "cooldownMinutes"
  | "environment"
  | "enabled"
  | "channelIds"
>;

const deliverySchema = z.object({
  channelId: z.string(),
  channelName: z.string(),
  channelKind: z.string(),
  status: z.enum(["sent", "failed"]),
  attempts: z.number().int(),
  errorCode: z.string().optional(),
  at: iso,
});
export type AlertDelivery = z.infer<typeof deliverySchema>;

export const deliveryStates = [
  "delivered",
  "partial",
  "failed",
  "pending",
  "no_channels",
  "cooldown",
] as const;
export type DeliveryState = (typeof deliveryStates)[number];

const notificationSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  title: z.string(),
  metric: z.enum(alertMetrics),
  comparator: z.enum(alertComparators),
  environment: z.string(),
  value: z.number(),
  threshold: z.number(),
  occurredAt: iso,
  deepLink: z.string(),
  status: z.string(),
  delivery: z.enum(deliveryStates).catch("pending"),
  deliveries: z.array(deliverySchema).default([]),
});
export type AlertNotification = z.infer<typeof notificationSchema>;

export const alertsSchema = z.object({
  rules: z.array(ruleSchema),
  notifications: z.array(notificationSchema),
  canManage: z.boolean().default(false),
});

const channelSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  kind: z.enum(storedChannelKinds),
  enabled: z.boolean(),
  ruleCount: z.number().int().default(0),
  createdAt: iso,
});
export type NotificationChannel = z.infer<typeof channelSchema>;
const channelsSchema = z.object({
  channels: z.array(channelSchema),
  canManage: z.boolean().default(false),
});
const channelTestSchema = z.object({
  delivered: z.boolean(),
  errorCode: z.string().optional(),
});
export type ChannelTestResult = z.infer<typeof channelTestSchema>;

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...csrfHeaders() },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const alertsPath = (projectId: string) =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/alerts`;
const channelsPath = (organizationId: string) =>
  `/api/v1/organizations/${encodeURIComponent(organizationId)}/channels`;

export function getAlerts(projectId: string, signal?: AbortSignal) {
  return requestJSON(alertsSchema, alertsPath(projectId), { signal });
}

export function createAlert(projectId: string, input: AlertRuleInput) {
  return requestJSON(ruleSchema, alertsPath(projectId), json("POST", input));
}

export function updateAlert(projectId: string, ruleId: string, input: Partial<AlertRuleInput>) {
  return requestJSON(
    ruleSchema,
    `${alertsPath(projectId)}/${encodeURIComponent(ruleId)}`,
    json("PATCH", input),
  );
}

export function deleteAlert(projectId: string, ruleId: string) {
  return requestJSON(
    z.unknown(),
    `${alertsPath(projectId)}/${encodeURIComponent(ruleId)}`,
    json("DELETE"),
  );
}

export function getChannels(organizationId: string, signal?: AbortSignal) {
  return requestJSON(channelsSchema, channelsPath(organizationId), { signal });
}

export type ChannelInput = {
  name?: string;
  kind?: StoredChannelKind;
  enabled?: boolean;
  /** Kind-specific settings. Secret fields left blank keep their stored value. */
  settings?: Record<string, string>;
};

export function createChannel(organizationId: string, input: ChannelInput) {
  return requestJSON(channelSchema, channelsPath(organizationId), json("POST", input));
}

export function updateChannel(organizationId: string, channelId: string, input: ChannelInput) {
  return requestJSON(
    channelSchema,
    `${channelsPath(organizationId)}/${encodeURIComponent(channelId)}`,
    json("PATCH", input),
  );
}

export function deleteChannel(organizationId: string, channelId: string) {
  return requestJSON(
    z.unknown(),
    `${channelsPath(organizationId)}/${encodeURIComponent(channelId)}`,
    json("DELETE"),
  );
}

export function testChannel(organizationId: string, channelId: string) {
  return requestJSON(
    channelTestSchema,
    `${channelsPath(organizationId)}/${encodeURIComponent(channelId)}/test`,
    json("POST"),
  );
}
