import { z } from "zod";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON } from "./client";

const isoTime = z.iso.datetime({ offset: true });
export const releaseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  version: z.string(),
  dist: z.string(),
  commitSha: z.string(),
  deployedAt: isoTime.nullable().optional(),
  createdAt: isoTime,
  updatedAt: isoTime,
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
const mappedStackSchema = z.object({
  raw: z.string(),
  status: z.enum(["mapped", "partial", "failed"]),
  failure: z.string().optional(),
  frames: z.array(
    z.object({
      function: z.string().optional(),
      url: z.string(),
      line: z.number().int(),
      column: z.number().int(),
      failure: z.string().optional(),
      original: z
        .object({
          source: z.string(),
          function: z.string().optional(),
          line: z.number().int(),
          column: z.number().int(),
          sourceContent: z.string().optional(),
        })
        .optional(),
    }),
  ),
});
export type Release = z.infer<typeof releaseSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type SourceMapMatch = z.infer<typeof mappedStackSchema>;

export function listReleases(projectId: string, signal?: AbortSignal) {
  return requestJSON(
    z.object({ releases: z.array(releaseSchema) }),
    `/api/v1/projects/${encodeURIComponent(projectId)}/releases`,
    { signal },
  );
}
export function createRelease(
  projectId: string,
  input: { version: string; dist: string; commitSha: string },
) {
  return requestJSON(releaseSchema, `/api/v1/projects/${encodeURIComponent(projectId)}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ ...input, deployedAt: new Date().toISOString() }),
  });
}
export function listArtifacts(projectId: string, releaseId: string, signal?: AbortSignal) {
  return requestJSON(
    z.object({ artifacts: z.array(artifactSchema) }),
    `/api/v1/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}/artifacts`,
    { signal },
  );
}
export async function uploadArtifact(projectId: string, releaseId: string, file: File) {
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
  ]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const grant = await requestJSON(
    z.object({
      artifact: artifactSchema,
      uploadUrl: z.string().url(),
      method: z.string(),
      headers: z.record(z.string(), z.string()),
      expiresAt: isoTime,
    }),
    `/api/v1/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}/artifacts/presign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ artifactName: file.name, sha256, sizeBytes: file.size }),
    },
  );
  const uploaded = await fetch(grant.uploadUrl, {
    method: grant.method,
    headers: grant.headers,
    body: file,
  });
  if (!uploaded.ok) throw new Error(`OSS upload failed (${uploaded.status})`);
  return requestJSON(
    artifactSchema,
    `/api/v1/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}/artifacts/${encodeURIComponent(grant.artifact.id)}/complete`,
    { method: "POST", headers: csrfHeaders() },
  );
}
export async function deleteArtifact(projectId: string, releaseId: string, artifactId: string) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}/artifacts/${encodeURIComponent(artifactId)}`,
    { method: "DELETE", credentials: "same-origin", headers: csrfHeaders() },
  );
  if (!response.ok) throw new Error("删除 Source Map 失败");
}
export function testSourceMap(
  projectId: string,
  input: { release: string; dist: string; stack: string },
) {
  return requestJSON(
    mappedStackSchema,
    `/api/v1/projects/${encodeURIComponent(projectId)}/sourcemaps/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
  );
}
