import { z } from "zod";
import { requestJSON } from "./client";

const usageResponseSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  intervalSeconds: z.number().int().positive(),
  totals: z.object({
    accepted: z.number().int().nonnegative(),
    estimated: z.number().nonnegative(),
    sampled: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
  breakdown: z.array(
    z.object({
      bucket: z.iso.datetime({ offset: true }),
      eventType: z.string(),
      outcome: z.string(),
      reason: z.string().default(""),
      events: z.number().int().nonnegative(),
      estimated: z.number().nonnegative(),
      bytes: z.number().int().nonnegative(),
    }),
  ),
});

export type UsageResponse = z.infer<typeof usageResponseSchema>;

export function usageRange(days = 7) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export function usageURL(projectId: string, range: { from: Date; to: Date }, csv = false) {
  const parameters = new URLSearchParams({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  });
  return `/api/v1/projects/${encodeURIComponent(projectId)}/usage${csv ? ".csv" : ""}?${parameters}`;
}

export function getUsage(projectId: string, range: { from: Date; to: Date }, signal?: AbortSignal) {
  return requestJSON(usageResponseSchema, usageURL(projectId, range), { signal });
}
