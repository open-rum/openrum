import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { requestJSON } from "./client";
import { csrfHeaders } from "@/lib/auth/session";

const isoTime = z.iso.datetime({ offset: true });

export const adminOverviewSchema = z.object({
  version: z.string(),
  environment: z.string(),
  deploymentMode: z.enum(["standalone", "kubernetes"]),
  startedAt: isoTime,
  uptimeSeconds: z.number().int().nonnegative(),
  lastMigrationAt: isoTime.nullable(),
  dependencies: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(["healthy", "unhealthy", "configured", "not_configured", "unknown"]),
      latencyMs: z.number().int().nonnegative().nullable(),
      detail: z.string(),
    }),
  ),
  pipeline: z.object({
    latestEventAt: isoTime.nullable(),
    kafkaLag: z.number().int().nonnegative().nullable(),
    failedJobs: z.number().int().nonnegative().nullable(),
    capacity: z.object({
      status: z.enum(["available", "unknown"]),
      mode: z.enum(["normal", "warning", "sampling", "blocked", "unknown"]),
      pressure: z.enum(["normal", "warning", "critical", "unknown"]),
      usedBytes: z.number().nonnegative().nullable(),
      freeBytes: z.number().nonnegative().nullable(),
      capacityBytes: z.number().nonnegative().nullable(),
      usedPercent: z.number().nonnegative().max(100).nullable(),
      automaticSamplingActive: z.boolean(),
      automaticSamplingRate: z.number().min(0).max(1).nullable(),
      ingestBlocked: z.boolean(),
      observedAt: isoTime.nullable(),
      detail: z.string(),
    }),
  }),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export function reauthenticateAdmin(currentPassword: string) {
  return requestJSON(
    z.object({ elevated: z.literal(true), expiresInSeconds: z.number().int().positive() }),
    "/api/v1/auth/reauthenticate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ currentPassword }),
    },
  );
}

export function adminOverviewQueryOptions() {
  return queryOptions({
    queryKey: ["admin", "overview"],
    queryFn: ({ signal }) => requestJSON(adminOverviewSchema, "/api/v1/admin/overview", { signal }),
    staleTime: 15_000,
  });
}

export const objectStorageStatusSchema = z.object({
  provider: z.enum(["none", "oss", "s3"]),
  providerLabel: z.string(),
  configured: z.boolean(),
  region: z.string(),
  bucket: z.string(),
  endpoint: z.string(),
  diagnosticPrefix: z.string(),
  credentialSource: z.enum([
    "none",
    "ram_role",
    "iam_role",
    "environment",
    "kubernetes_secret",
    "managed_encrypted",
  ]),
  maskedIdentity: z.string(),
  managedBy: z.string(),
  testAvailable: z.boolean(),
  managedSecretsAvailable: z.boolean(),
  configurationSource: z.string(),
});

export const objectStorageProbeSchema = z.object({
  success: z.boolean(),
  errorCode: z.string().optional(),
  startedAt: isoTime,
  durationMs: z.number().int().nonnegative(),
  steps: z.array(
    z.object({
      name: z.enum(["write", "read", "delete"]),
      status: z.enum(["passed", "failed"]),
      latencyMs: z.number().int().nonnegative(),
    }),
  ),
});

export type ObjectStorageStatus = z.infer<typeof objectStorageStatusSchema>;
export type ObjectStorageProbe = z.infer<typeof objectStorageProbeSchema>;

export function objectStorageStatusQueryOptions() {
  return queryOptions({
    queryKey: ["admin", "object-storage"],
    queryFn: ({ signal }) =>
      requestJSON(objectStorageStatusSchema, "/api/v1/admin/object-storage", { signal }),
  });
}

export function testObjectStorage() {
  return requestJSON(objectStorageProbeSchema, "/api/v1/admin/object-storage/test", {
    method: "POST",
    headers: csrfHeaders(),
  });
}

export function putManagedObjectStorage(input: {
  provider: "oss" | "s3";
  endpoint: string;
  bucket: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  return requestJSON(
    z.object({
      configured: z.literal(true),
      version: z.number().int().positive(),
      keyId: z.string(),
      probe: objectStorageProbeSchema,
    }),
    "/api/v1/admin/object-storage/managed",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
  );
}

export const adminSettingSchema = z.object({
  namespace: z.string(),
  key: z.string(),
  effectiveValue: z.number().int(),
  source: z.enum(["default", "instance", "project", "deployment"]),
  locked: z.boolean(),
  version: z.number().int().nonnegative(),
  updatedAt: isoTime.nullable(),
});

export const adminConfigurationSchema = z.object({ settings: z.array(adminSettingSchema) });
export type AdminSetting = z.infer<typeof adminSettingSchema>;

export function adminConfigurationQueryOptions() {
  return queryOptions({
    queryKey: ["admin", "configuration"],
    queryFn: ({ signal }) =>
      requestJSON(adminConfigurationSchema, "/api/v1/admin/configuration", { signal }),
  });
}

export function updateAdminSetting(input: {
  namespace: string;
  key: string;
  value: number;
  expectedVersion: number;
}) {
  return requestJSON(adminSettingSchema, "/api/v1/admin/configuration", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(input),
  });
}

export const retentionPreviewSchema = z.object({
  previewToken: z.string(),
  expiresAt: isoTime,
  projectId: z.string(),
  rawDays: z.number().int().positive(),
  aggregateDays: z.number().int().positive(),
  affectedRows: z.number().int().nonnegative(),
  deleteRows: z.number().int().nonnegative(),
  cannotRestoreDeletedData: z.boolean(),
  steps: z.array(
    z.object({
      table: z.string(),
      timeColumn: z.string(),
      month: z.number().int(),
      retentionDays: z.number().int().positive(),
      affectedRows: z.number().int().nonnegative(),
      deleteRows: z.number().int().nonnegative(),
    }),
  ),
});

export const maintenanceJobSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(["queued", "running", "retry", "completed", "failed"]),
  projectId: z.string(),
  rawDays: z.number().int().positive(),
  aggregateDays: z.number().int().positive(),
  affectedRows: z.number().int().nonnegative(),
  deleteRows: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  completedSteps: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().optional(),
  createdAt: isoTime,
  updatedAt: isoTime,
  startedAt: isoTime.nullable(),
  completedAt: isoTime.nullable(),
});

export type RetentionPreview = z.infer<typeof retentionPreviewSchema>;
export type MaintenanceJob = z.infer<typeof maintenanceJobSchema>;

export function previewRetention(input: {
  projectId: string;
  rawDays: number;
  aggregateDays: number;
}) {
  return requestJSON(retentionPreviewSchema, "/api/v1/admin/retention-policy/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(input),
  });
}

export function createRetentionJob(input: { previewToken: string; currentPassword: string }) {
  return requestJSON(maintenanceJobSchema, "/api/v1/admin/retention-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(input),
  });
}

export function maintenanceJobsQueryOptions() {
  return queryOptions({
    queryKey: ["admin", "maintenance-jobs"],
    queryFn: ({ signal }) =>
      requestJSON(
        z.object({ jobs: z.array(maintenanceJobSchema) }),
        "/api/v1/admin/maintenance-jobs",
        {
          signal,
        },
      ),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => ["queued", "running", "retry"].includes(job.status))
        ? 3_000
        : false,
  });
}

export const emergencyCleanupJobSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "retry", "completed", "failed"]),
  usedBytesBefore: z.number().int().nonnegative(),
  capacityBytes: z.number().int().positive(),
  estimatedReleaseBytes: z.number().int().nonnegative(),
  targetUsedPercent: z.number().int().min(1).max(99),
  protectedAfter: isoTime,
  canReachTarget: z.boolean(),
  totalSteps: z.number().int().positive(),
  completedSteps: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().optional(),
  createdAt: isoTime,
  updatedAt: isoTime,
  startedAt: isoTime.nullable(),
  completedAt: isoTime.nullable(),
});

export const emergencyCleanupPreviewSchema = z.object({
  previewToken: z.string(),
  expiresAt: isoTime,
  usedBytes: z.number().int().nonnegative(),
  capacityBytes: z.number().int().positive(),
  estimatedReleaseBytes: z.number().int().positive(),
  projectedUsedBytes: z.number().int().nonnegative(),
  targetUsedPercent: z.number().int().min(1).max(99),
  protectedAfter: isoTime,
  canReachTarget: z.boolean(),
  groups: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      month: z.number().int(),
      affectedRows: z.number().int().nonnegative(),
      estimatedBytes: z.number().int().positive(),
      oldestAt: isoTime,
      newestAt: isoTime,
    }),
  ),
});

export type EmergencyCleanupJob = z.infer<typeof emergencyCleanupJobSchema>;
export type EmergencyCleanupPreview = z.infer<typeof emergencyCleanupPreviewSchema>;

export function previewEmergencyCleanup() {
  return requestJSON(emergencyCleanupPreviewSchema, "/api/v1/admin/emergency-cleanup/preview", {
    method: "POST",
    headers: csrfHeaders(),
  });
}

export function createEmergencyCleanupJob(input: {
  previewToken: string;
  confirmation: string;
  currentPassword: string;
}) {
  return requestJSON(emergencyCleanupJobSchema, "/api/v1/admin/emergency-cleanup/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(input),
  });
}

export function emergencyCleanupJobQueryOptions() {
  return queryOptions({
    queryKey: ["admin", "emergency-cleanup", "latest"] as const,
    queryFn: ({ signal }) =>
      requestJSON(
        z.object({ job: emergencyCleanupJobSchema.nullable() }),
        "/api/v1/admin/emergency-cleanup/jobs/latest",
        { signal },
      ),
    refetchInterval: (query) =>
      query.state.data?.job && ["queued", "running", "retry"].includes(query.state.data.job.status)
        ? 2_000
        : false,
  });
}

export const instanceAuditEntrySchema = z.object({
  id: z.number().int().positive(),
  actorEmail: z.string(),
  requestId: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourcePath: z.string(),
  configSource: z.string(),
  changeSummary: z.record(z.string(), z.unknown()),
  createdAt: isoTime,
});

export type InstanceAuditEntry = z.infer<typeof instanceAuditEntrySchema>;

export function instanceAuditQueryOptions() {
  return queryOptions({
    queryKey: ["admin", "audit-logs"],
    queryFn: ({ signal }) =>
      requestJSON(
        z.object({ entries: z.array(instanceAuditEntrySchema) }),
        "/api/v1/admin/audit-logs",
        {
          signal,
        },
      ),
  });
}
