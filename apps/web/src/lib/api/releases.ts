import { z } from "zod";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON, requestJSONWithStatus, requestNoContent } from "./client";
import { mappedStackSchema } from "./issues";

const isoTime = z.iso.datetime({ offset: true });

/** Server-side ceiling for one Source Map artifact (sourcemap.MaxMapBytes, 64 MiB). */
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

export const releaseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  version: z.string(),
  dist: z.string(),
  commitSha: z.string(),
  deployedAt: isoTime.nullable().optional(),
  createdAt: isoTime,
  updatedAt: isoTime,
  artifactCount: z.number().int().nonnegative().default(0),
  readyCount: z.number().int().nonnegative().default(0),
});
export const artifactSchema = z.object({
  id: z.string(),
  releaseId: z.string(),
  artifactName: z.string(),
  sizeBytes: z.number().int().positive(),
  status: z.enum(["pending", "ready", "failed"]),
  errorMessage: z.string().nullable().optional(),
  createdAt: isoTime,
  updatedAt: isoTime,
});
const releasePageSchema = z.object({
  releases: z.array(releaseSchema),
  nextCursor: z.string().nullable().optional(),
});
const sourceMapStatusSchema = z.object({
  storage: z.enum(["ready", "not_configured", "unavailable"]),
  maxArtifactBytes: z.number().int().positive().default(MAX_ARTIFACT_BYTES),
  remapWindowDays: z.number().int().positive().default(7),
  // False when storage refuses deletes: deleting files leaves them in the bucket.
  deleteAllowed: z.boolean().default(true),
});
const presignSchema = z.union([
  z.object({ artifact: artifactSchema, skipped: z.literal(true) }),
  z.object({
    artifact: artifactSchema,
    skipped: z.literal(false).optional(),
    uploadUrl: z.string().url(),
    method: z.string(),
    headers: z.record(z.string(), z.string()),
    expiresAt: isoTime,
  }),
]);

export type Release = z.infer<typeof releaseSchema>;
export type ReleasePage = z.infer<typeof releasePageSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type SourceMapMatch = z.infer<typeof mappedStackSchema>;
export type SourceMapStatus = z.infer<typeof sourceMapStatusSchema>;
export type PresignResult = z.infer<typeof presignSchema>;

function projectPath(projectId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}`;
}
function releasePath(projectId: string, releaseId: string) {
  return `${projectPath(projectId)}/releases/${encodeURIComponent(releaseId)}`;
}
function jsonHeaders() {
  return { "Content-Type": "application/json", ...csrfHeaders() };
}

export function listReleases(
  projectId: string,
  options: { q?: string; cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.q) parameters.set("q", options.q);
  if (options.cursor) parameters.set("cursor", options.cursor);
  return requestJSON(
    releasePageSchema,
    `${projectPath(projectId)}/releases?${parameters.toString()}`,
    { signal },
  );
}

/** Idempotent: an existing (version, dist) comes back with `created: false`. */
export async function createRelease(
  projectId: string,
  input: { version: string; dist: string; commitSha: string },
) {
  const { data, status } = await requestJSONWithStatus(
    releaseSchema,
    `${projectPath(projectId)}/releases`,
    {
      method: "POST",
      headers: jsonHeaders(),
      // Registering a release is not deploying it; the list shows "登记于" until a
      // deploy time is reported.
      body: JSON.stringify(input),
    },
  );
  return { release: data, created: status === 201 };
}

function deleteRequest(path: string, fallback: string) {
  return requestNoContent(path, { method: "DELETE", headers: csrfHeaders() }, fallback);
}

export function deleteRelease(projectId: string, releaseId: string) {
  return deleteRequest(releasePath(projectId, releaseId), "删除版本失败，请稍后重试。");
}

export function getSourceMapStatus(projectId: string, signal?: AbortSignal) {
  return requestJSON(sourceMapStatusSchema, `${projectPath(projectId)}/sourcemaps/status`, {
    signal,
  });
}

export function listArtifacts(projectId: string, releaseId: string, signal?: AbortSignal) {
  return requestJSON(
    z.object({ artifacts: z.array(artifactSchema) }),
    `${releasePath(projectId, releaseId)}/artifacts`,
    { signal },
  );
}

export function presignArtifact(
  projectId: string,
  releaseId: string,
  input: { artifactName: string; sha256: string; sizeBytes: number; replace?: boolean },
) {
  return requestJSON(presignSchema, `${releasePath(projectId, releaseId)}/artifacts/presign`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

export function completeArtifact(projectId: string, releaseId: string, artifactId: string) {
  return requestJSON(
    artifactSchema,
    `${releasePath(projectId, releaseId)}/artifacts/${encodeURIComponent(artifactId)}/complete`,
    { method: "POST", headers: csrfHeaders() },
  );
}

/** Failure of the direct PUT to object storage; status 0 means the request never got a response. */
export class ObjectUploadError extends Error {
  constructor(readonly status: number) {
    super(status ? `对象存储返回 HTTP ${status}` : "无法连接对象存储");
  }
}

/** PUTs bytes straight to the presigned URL with XMLHttpRequest so upload progress is observable. */
export function putArtifactBytes(
  grant: { uploadUrl: string; method: string; headers: Record<string, string> },
  file: Blob,
  onProgress: (fraction: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(grant.method || "PUT", grant.uploadUrl);
    for (const [name, value] of Object.entries(grant.headers)) {
      // Browsers set these themselves and throw on attempts to override them.
      if (/^(content-length|host)$/i.test(name)) continue;
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
      } else reject(new ObjectUploadError(request.status));
    };
    request.onerror = () => reject(new ObjectUploadError(0));
    request.onabort = () => reject(new ObjectUploadError(0));
    request.send(file);
  });
}

export async function sha256Hex(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function deleteArtifact(projectId: string, releaseId: string, artifactId: string) {
  return deleteRequest(
    `${releasePath(projectId, releaseId)}/artifacts/${encodeURIComponent(artifactId)}`,
    "删除 Source Map 失败，请稍后重试。",
  );
}

export function testSourceMap(
  projectId: string,
  input: { release: string; dist: string; stack: string },
) {
  return requestJSON(mappedStackSchema, `${projectPath(projectId)}/sourcemaps/test`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}
