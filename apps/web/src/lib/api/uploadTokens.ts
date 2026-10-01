import { z } from "zod";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON, requestNoContent } from "./client";

const isoTime = z.iso.datetime({ offset: true });

export const uploadTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenPrefix: z.string(),
  createdByName: z.string().nullable().optional(),
  createdAt: isoTime,
  lastUsedAt: isoTime.nullable().optional(),
  revokedAt: isoTime.nullable().optional(),
});
const uploadTokenListSchema = z.object({
  tokens: z.array(uploadTokenSchema),
  canManage: z.boolean(),
});
const createdUploadTokenSchema = z.object({ token: uploadTokenSchema, secret: z.string() });

export type UploadToken = z.infer<typeof uploadTokenSchema>;
export type UploadTokenList = z.infer<typeof uploadTokenListSchema>;

function tokensPath(projectId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/upload-tokens`;
}

export function listUploadTokens(projectId: string, signal?: AbortSignal) {
  return requestJSON(uploadTokenListSchema, tokensPath(projectId), { signal });
}

export function createUploadToken(projectId: string, name: string) {
  return requestJSON(createdUploadTokenSchema, tokensPath(projectId), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ name }),
  });
}

export function revokeUploadToken(projectId: string, tokenId: string) {
  return requestNoContent(
    `${tokensPath(projectId)}/${encodeURIComponent(tokenId)}`,
    { method: "DELETE", headers: csrfHeaders() },
    "吊销上传令牌失败，请稍后重试。",
  );
}
