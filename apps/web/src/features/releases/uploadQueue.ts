import { HTTPError } from "@/lib/auth/session";
import {
  MAX_ARTIFACT_BYTES,
  ObjectUploadError,
  type Artifact,
  type PresignResult,
} from "@/lib/api/releases";

// Pure upload logic for the Releases page: naming, planning, error wording and the
// bounded-concurrency queue. React state lives in useArtifactUpload; everything here is
// plain TypeScript so it can be unit tested without a DOM.

export const UPLOAD_CONCURRENCY = 3;

export type SelectedFile = {
  file: File;
  /** Path relative to the build output directory, always with forward slashes. */
  relativePath: string;
};

export type UploadStatus =
  "waiting" | "hashing" | "uploading" | "verifying" | "ready" | "skipped" | "failed";

export type UploadFailure = { code: string; message: string; canReplace: boolean };

export type UploadItem = {
  id: string;
  file: File;
  relativePath: string;
  artifactName: string;
  status: UploadStatus;
  /** 0–1, only meaningful while uploading. */
  progress: number;
  error?: UploadFailure;
};

export type UploadDeps = {
  hash: (file: Blob) => Promise<string>;
  presign: (input: {
    artifactName: string;
    sha256: string;
    sizeBytes: number;
    replace?: boolean;
  }) => Promise<PresignResult>;
  put: (
    grant: { uploadUrl: string; method: string; headers: Record<string, string> },
    file: Blob,
    onProgress: (fraction: number) => void,
  ) => Promise<void>;
  complete: (artifactId: string) => Promise<Artifact>;
};

export const ACTIVE_STATUSES: ReadonlySet<UploadStatus> = new Set([
  "waiting",
  "hashing",
  "uploading",
  "verifying",
]);

function toPosix(path: string) {
  return path.replace(/\\/g, "/");
}

/**
 * Turns whatever the user typed into a clean URL path prefix (same rule as the Vite plugin's
 * `urlPrefix`): pasted URLs lose their scheme, host, query and fragment; empty and "." segments
 * go; a non-empty prefix ends with exactly one "/".
 */
export function normalizeUrlPrefix(input: string) {
  const path = toPosix(input.trim())
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .replace(/[?#].*$/, "")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
  return path ? `${path}/` : "";
}

/** Final artifact name: the URL path prefix joined with the file's path in the build output. */
export function artifactNameFor(relativePath: string, prefix: string) {
  const path = toPosix(relativePath)
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "");
  return `${normalizeUrlPrefix(prefix)}${path}`;
}

/**
 * Reads a file input selection. A folder pick reports paths including the chosen folder's
 * own name ("dist/assets/app.js.map"); that folder is the build output root, so the first
 * segment is dropped. Only `.map` files are kept.
 */
export function selectedFilesFrom(files: ArrayLike<File>) {
  const selected: SelectedFile[] = [];
  let ignored = 0;
  for (const file of Array.from(files)) {
    const fromFolder = toPosix(file.webkitRelativePath ?? "");
    const relativePath = fromFolder
      ? fromFolder.split("/").filter(Boolean).slice(1).join("/")
      : file.name;
    if (!relativePath || !relativePath.toLowerCase().endsWith(".map")) {
      ignored += 1;
      continue;
    }
    selected.push({ file, relativePath });
  }
  selected.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { files: selected, ignored };
}

function tooLarge(maxBytes: number): UploadFailure {
  return {
    code: "ARTIFACT_TOO_LARGE",
    message: `文件超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB 上限，未上传。请拆分产物或关闭该文件的 Source Map。`,
    canReplace: false,
  };
}

/** Builds the queue for one upload run; oversized files and duplicate names fail before hashing. */
export function planUploads(
  files: SelectedFile[],
  prefix: string,
  maxBytes = MAX_ARTIFACT_BYTES,
): UploadItem[] {
  const seen = new Set<string>();
  return files.map(({ file, relativePath }, index) => {
    const artifactName = artifactNameFor(relativePath, prefix);
    const item: UploadItem = {
      id: `${index}:${artifactName}`,
      file,
      relativePath,
      artifactName,
      status: "waiting",
      progress: 0,
    };
    if (file.size > maxBytes) return { ...item, status: "failed", error: tooLarge(maxBytes) };
    if (seen.has(artifactName))
      return {
        ...item,
        status: "failed",
        error: {
          code: "DUPLICATE_NAME",
          message: "本次选择中有同名文件，只上传第一个。",
          canReplace: false,
        },
      };
    seen.add(artifactName);
    return item;
  });
}

/** Maps API and transfer errors to specific, actionable Chinese copy. */
export function describeUploadError(error: unknown): UploadFailure {
  if (error instanceof ObjectUploadError) {
    return {
      code: "OBJECT_UPLOAD_FAILED",
      message: error.status
        ? `直传对象存储失败（HTTP ${error.status}）。请检查存储桶的 CORS 规则是否允许当前控制台域名的 PUT 请求。`
        : "无法连接对象存储。请检查网络，以及存储桶的 CORS 规则是否允许当前控制台域名。",
      canReplace: false,
    };
  }
  if (error instanceof HTTPError) {
    switch (error.code) {
      case "OBJECT_STORAGE_NOT_CONFIGURED":
        return {
          code: error.code,
          message: "实例尚未配置对象存储，无法保存 Source Map。请联系实例管理员配置。",
          canReplace: false,
        };
      case "OBJECT_STORAGE_UNAVAILABLE":
        return {
          code: error.code,
          message: "对象存储暂时不可用。请稍后重试，或请实例管理员检查存储连接。",
          canReplace: false,
        };
      case "ARTIFACT_MISMATCH":
        return {
          code: error.code,
          message: "服务端复核失败：存储中的内容与本地计算的 SHA-256 或大小不一致。请重新上传。",
          canReplace: false,
        };
      case "ARTIFACT_EXISTS":
        return {
          code: error.code,
          message: "该版本已有同名 Source Map，且内容不同。确认是新构建产物后可替换。",
          canReplace: true,
        };
      case "ARTIFACT_TOO_LARGE":
        return tooLarge(MAX_ARTIFACT_BYTES);
      case "VALIDATION_ERROR":
        return {
          code: error.code,
          message: `文件名或参数无效：${error.message}`,
          canReplace: false,
        };
      case "FORBIDDEN":
        return {
          code: error.code,
          message: "当前角色没有上传 Source Map 的权限。",
          canReplace: false,
        };
      case "NOT_FOUND":
        return {
          code: error.code,
          message: "版本不存在或已被删除，请刷新页面后重试。",
          canReplace: false,
        };
      default:
        return { code: error.code, message: error.message, canReplace: false };
    }
  }
  return {
    code: "UNKNOWN",
    message: error instanceof Error && error.message ? error.message : "上传失败，请重试。",
    canReplace: false,
  };
}

/**
 * Uploads one file: hash → presign → (skip | PUT → complete). Progress and the final state are
 * reported through `update`; it never throws, so one failure cannot stop the queue.
 */
export async function uploadOne(
  item: Pick<UploadItem, "file" | "artifactName">,
  deps: UploadDeps,
  update: (patch: Partial<UploadItem>) => void,
  options: { replace?: boolean; maxBytes?: number } = {},
) {
  const maxBytes = options.maxBytes ?? MAX_ARTIFACT_BYTES;
  if (item.file.size > maxBytes) {
    update({ status: "failed", progress: 0, error: tooLarge(maxBytes) });
    return;
  }
  try {
    update({ status: "hashing", progress: 0, error: undefined });
    const sha256 = await deps.hash(item.file);
    const grant = await deps.presign({
      artifactName: item.artifactName,
      sha256,
      sizeBytes: item.file.size,
      ...(options.replace ? { replace: true } : {}),
    });
    if (grant.skipped) {
      update({ status: "skipped", progress: 1 });
      return;
    }
    update({ status: "uploading", progress: 0 });
    await deps.put(grant, item.file, (fraction) =>
      update({ progress: Math.max(0, Math.min(1, fraction)) }),
    );
    update({ status: "verifying", progress: 1 });
    const artifact = await deps.complete(grant.artifact.id);
    if (artifact.status === "ready") update({ status: "ready" });
    else
      update({
        status: "failed",
        error: {
          code: "ARTIFACT_FAILED",
          message: artifact.errorMessage || "服务端校验未通过，请重新上传。",
          canReplace: false,
        },
      });
  } catch (error) {
    update({ status: "failed", error: describeUploadError(error) });
  }
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving start order. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

export function summarizeUploads(items: readonly UploadItem[]) {
  const summary = { ready: 0, skipped: 0, failed: 0, active: 0 };
  for (const item of items) {
    if (item.status === "ready") summary.ready += 1;
    else if (item.status === "skipped") summary.skipped += 1;
    else if (item.status === "failed") summary.failed += 1;
    else summary.active += 1;
  }
  return summary;
}
