import { z } from "zod";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON } from "./client";

const iso = z.iso.datetime({ offset: true });
const ruleSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  metric: z.string(),
  comparator: z.string(),
  threshold: z.number(),
  windowMinutes: z.number().int(),
  cooldownMinutes: z.number().int(),
  environment: z.string(),
  enabled: z.boolean(),
});
const notificationSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  title: z.string(),
  value: z.number(),
  threshold: z.number(),
  occurredAt: iso,
  deepLink: z.string(),
  status: z.string(),
});
export const alertsSchema = z.object({
  rules: z.array(ruleSchema),
  notifications: z.array(notificationSchema),
});
const channelSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  kind: z.enum(["smtp", "webhook"]),
  enabled: z.boolean(),
  createdAt: iso,
});
const channelsSchema = z.object({ channels: z.array(channelSchema) });
export type AlertRule = z.infer<typeof ruleSchema>;

export function getAlerts(projectId: string, signal?: AbortSignal) {
  return requestJSON(alertsSchema, `/api/v1/projects/${encodeURIComponent(projectId)}/alerts`, {
    signal,
  });
}

export function createAlert(projectId: string, input: Omit<AlertRule, "id" | "projectId">) {
  return requestJSON(ruleSchema, `/api/v1/projects/${encodeURIComponent(projectId)}/alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(input),
  });
}

export function getChannels(organizationId: string, signal?: AbortSignal) {
  return requestJSON(
    channelsSchema,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/channels`,
    { signal },
  );
}

export function createWebhookChannel(
  organizationId: string,
  input: { name: string; url: string; secret: string },
) {
  return requestJSON(
    channelSchema,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ ...input, kind: "webhook" }),
    },
  );
}
