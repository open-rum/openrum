import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { requestJSON } from "./client";

export const storagePressureSchema = z.object({
  mode: z.enum(["normal", "warning", "sampling", "blocked", "unknown"]),
  level: z.enum(["normal", "warning", "critical", "unknown"]),
  usedPercent: z.number().min(0).max(100).nullable(),
  automaticSamplingActive: z.boolean(),
  automaticSamplingRate: z.number().min(0).max(1).nullable(),
  ingestBlocked: z.boolean(),
  observedAt: z.iso.datetime({ offset: true }).nullable(),
});

export type StoragePressure = z.infer<typeof storagePressureSchema>;

export function storagePressureQueryOptions() {
  return queryOptions({
    queryKey: ["storage-pressure"] as const,
    queryFn: ({ signal }) =>
      requestJSON(storagePressureSchema, "/api/v1/storage-pressure", { signal }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
