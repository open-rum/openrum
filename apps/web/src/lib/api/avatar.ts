import { apiFetch, csrfHeaders } from "@/lib/auth/session";

const protectedRequest = { redirectOnUnauthorized: true } as const;

export type AvatarStatus = {
  /** True once object storage is configured and working. Generated avatars never need it. */
  uploadAvailable: boolean;
  maxUploadBytes: number;
  styles: string[];
};

export const avatarStatusQueryKey = ["auth", "avatar", "status"] as const;

export function getAvatarStatus(signal?: AbortSignal) {
  return apiFetch<AvatarStatus>("/api/v1/auth/avatar/status", { signal }, protectedRequest);
}

/** Picks a generated avatar, or goes back to initials with null. */
export function setAvatar(avatar: string | null) {
  return apiFetch<{ avatar: string | null }>(
    "/api/v1/auth/avatar",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ avatar }),
    },
    protectedRequest,
  );
}

export function uploadAvatar(png: Blob) {
  return apiFetch<{ avatar: string }>(
    "/api/v1/auth/avatar",
    { method: "PUT", headers: { "Content-Type": "image/png", ...csrfHeaders() }, body: png },
    protectedRequest,
  );
}
