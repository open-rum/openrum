import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

/** Largest Source Map the server accepts (64 MiB). */
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

export type OpenRUMLogger = {
  info(message: string): void;
  warn(message: string): void;
};

export type OpenRUMSourceMapOptions = {
  /** OpenRUM API origin, for example `https://rum.example.com`. */
  baseUrl: string;
  projectId: string;
  /** Must equal the `release` passed to the browser SDK `init()`. */
  release: string;
  /** Must equal the `dist` passed to the browser SDK `init()`, when used. */
  dist?: string;
  commitSha?: string;
  /** Build output directory. Defaults to Vite's `build.outDir`, or `dist` for the CLI. */
  outDir?: string;
  /**
   * URL path segment placed before each file's path relative to `outDir`, for a
   * Vite `base` or CDN sub-path such as `static/app/`. A full URL is accepted and
   * reduced to its path.
   */
  urlPrefix?: string;
  /** Project Source Map upload token (`orut_...`). Defaults to `OPENRUM_UPLOAD_TOKEN`. */
  token?: string;
  /** Overwrite a ready Artifact with the same name but different contents. */
  replace?: boolean;
  /** @deprecated Use `token`. Console session cookie value. */
  sessionCookie?: string;
  /** @deprecated Use `token`. Console CSRF token matching `sessionCookie`. */
  csrfToken?: string;
  /** Parallel uploads. Defaults to 4. */
  concurrency?: number;
  /** Retries for network errors, 5xx and 429 responses. Defaults to 2. */
  retries?: number;
  /** Base delay for exponential retry backoff. Defaults to 500 ms. */
  retryDelayMs?: number;
  /** Receives the upload summary. Defaults to Vite's logger or the console. */
  logger?: OpenRUMLogger;
};

export type SourceMapFileResult = {
  artifactName: string;
  status: "uploaded" | "skipped" | "failed";
  error?: string;
};

export type SourceMapUploadResult = {
  releaseId: string | undefined;
  uploaded: number;
  skipped: number;
  failed: number;
  files: SourceMapFileResult[];
};

export class OpenRUMApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, status: number, code?: string, requestId?: string) {
    super(message);
    this.name = "OpenRUMApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export class OpenRUMUploadError extends Error {
  readonly result: SourceMapUploadResult;

  constructor(message: string, result: SourceMapUploadResult) {
    super(message);
    this.name = "OpenRUMUploadError";
    this.result = result;
  }
}

type Release = { id: string };
type Artifact = { id: string };
type Presign = {
  artifact: Artifact;
  skipped?: boolean;
  uploadUrl?: string;
  method?: string;
  headers?: Record<string, string>;
};
type LocalMap = {
  artifactName: string;
  contents?: NonSharedBuffer;
  sizeBytes: number;
};

export async function uploadSourceMaps(
  options: OpenRUMSourceMapOptions,
): Promise<SourceMapUploadResult> {
  const auth = validateOptions(options);
  const logger = options.logger ?? console;
  if (auth.kind === "session")
    logger.warn(
      "OpenRUM: sessionCookie/csrfToken authentication is deprecated. Create a Source Map upload token under Settings → Project → Onboarding and pass it as `token` or OPENRUM_UPLOAD_TOKEN.",
    );

  const output = resolve(options.outDir ?? "dist");
  const paths = await findFiles(output, (name) => name.endsWith(".map"));
  if (!paths.length) {
    logger.info(`OpenRUM: no Source Maps found in ${output}; nothing to upload.`);
    return { releaseId: undefined, uploaded: 0, skipped: 0, failed: 0, files: [] };
  }
  const prefix = normalizeUrlPrefix(options.urlPrefix);
  const maps: LocalMap[] = await Promise.all(
    paths.map(async (path) => {
      const artifactName = prefix + relative(output, path).split(sep).join("/");
      const { size } = await stat(path);
      // Oversized maps are rejected locally, so do not hold them in memory.
      if (size > MAX_ARTIFACT_BYTES) return { artifactName, sizeBytes: size };
      return { artifactName, sizeBytes: size, contents: await readFile(path) };
    }),
  );

  // Remove maps and their references before any network request, so an upload
  // failure can never leave a public build directory pointing at source code.
  await Promise.all(paths.map((path) => rm(path, { force: true })));
  await stripSourceMappingComments(output);

  const client = new ApiClient(options, auth);
  // Creating a Release is idempotent: an existing (version, dist) returns 200.
  const release = await client
    .json<Release>(`/api/v1/projects/${encodeURIComponent(options.projectId)}/releases`, {
      method: "POST",
      body: JSON.stringify({
        version: options.release,
        dist: options.dist ?? "",
        commitSha: options.commitSha ?? "",
        deployedAt: new Date().toISOString(),
      }),
    })
    .catch((error: unknown) => {
      throw new Error(
        `OpenRUM could not create release ${options.release}: ${describeFailure(error, options)}`,
        { cause: error },
      );
    });

  const files: SourceMapFileResult[] = new Array(maps.length);
  let abortReason: string | undefined;
  let next = 0;
  const worker = async () => {
    while (next < maps.length) {
      const index = next++;
      const map = maps[index]!;
      if (abortReason) {
        files[index] = { artifactName: map.artifactName, status: "failed", error: abortReason };
        continue;
      }
      try {
        const skipped = await uploadOne(client, options, release.id, map);
        files[index] = { artifactName: map.artifactName, status: skipped ? "skipped" : "uploaded" };
      } catch (error) {
        const message = describeFailure(error, options);
        files[index] = { artifactName: map.artifactName, status: "failed", error: message };
        if (isFatal(error)) abortReason = `not attempted: ${message}`;
      }
    }
  };
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  await Promise.all(Array.from({ length: Math.min(concurrency, maps.length) }, worker));

  const result: SourceMapUploadResult = {
    releaseId: release.id,
    uploaded: files.filter((file) => file.status === "uploaded").length,
    skipped: files.filter((file) => file.status === "skipped").length,
    failed: files.filter((file) => file.status === "failed").length,
    files,
  };
  const label = options.dist ? `${options.release} (dist ${options.dist})` : options.release;
  const summary = `OpenRUM Source Maps for release ${label}: ${result.uploaded} uploaded, ${result.skipped} skipped (unchanged), ${result.failed} failed.`;
  if (result.failed) {
    logger.warn(summary);
    for (const file of files)
      if (file.status === "failed") logger.warn(`  ✗ ${file.artifactName}: ${file.error}`);
    throw new OpenRUMUploadError(
      `OpenRUM Source Map upload failed for ${result.failed} of ${files.length} file(s).`,
      result,
    );
  }
  logger.info(summary);
  return result;
}

async function uploadOne(
  client: ApiClient,
  options: OpenRUMSourceMapOptions,
  releaseId: string,
  map: LocalMap,
): Promise<boolean> {
  if (!map.contents)
    throw new Error(
      `${formatBytes(map.sizeBytes)} exceeds the 64 MiB Source Map limit; split the bundle into smaller chunks`,
    );
  const releasePath = `/api/v1/projects/${encodeURIComponent(options.projectId)}/releases/${encodeURIComponent(releaseId)}`;
  const grant = await client.json<Presign>(`${releasePath}/artifacts/presign`, {
    method: "POST",
    body: JSON.stringify({
      artifactName: map.artifactName,
      sha256: createHash("sha256").update(map.contents).digest("hex"),
      sizeBytes: map.contents.byteLength,
      ...(options.replace ? { replace: true } : {}),
    }),
  });
  if (grant.skipped) return true;
  if (!grant.uploadUrl) throw new Error("the upload grant did not include an upload URL");
  const body = map.contents;
  await client.retry(async () => {
    const upload = await fetch(grant.uploadUrl!, {
      method: grant.method ?? "PUT",
      headers: grant.headers ?? {},
      body,
    });
    if (!upload.ok)
      throw new OpenRUMApiError(
        `object storage rejected the upload (${upload.status})`,
        upload.status,
      );
  });
  await client.json(`${releasePath}/artifacts/${encodeURIComponent(grant.artifact.id)}/complete`, {
    method: "POST",
  });
  return false;
}

export type Auth =
  { kind: "token"; token: string } | { kind: "session"; cookie: string; csrf: string };

class ApiClient {
  readonly #options: OpenRUMSourceMapOptions;
  readonly #auth: Auth;
  readonly #base: string;

  constructor(options: OpenRUMSourceMapOptions, auth: Auth) {
    this.#options = options;
    this.#auth = auth;
    this.#base = options.baseUrl.replace(/\/+$/, "");
  }

  async json<T = unknown>(path: string, init: RequestInit): Promise<T> {
    return this.retry(async () => {
      const response = await fetch(`${this.#base}${path}`, {
        ...init,
        headers: { ...this.#headers(), ...init.headers },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; requestId?: string };
      };
      if (!response.ok)
        throw new OpenRUMApiError(
          payload.error?.message ?? `OpenRUM API request failed (${response.status})`,
          response.status,
          payload.error?.code,
          payload.error?.requestId,
        );
      return payload as T;
    });
  }

  async retry<T>(operation: () => Promise<T>): Promise<T> {
    const retries = Math.max(0, Math.floor(this.#options.retries ?? DEFAULT_RETRIES));
    const delay = this.#options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt >= retries || !isTransient(error)) throw error;
        await new Promise((done) => setTimeout(done, delay * 2 ** attempt));
      }
    }
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.#auth.kind === "token") headers.Authorization = `Bearer ${this.#auth.token}`;
    else {
      headers.Cookie = `openrum_session=${this.#auth.cookie}; openrum_csrf=${this.#auth.csrf}`;
      headers["X-CSRF-Token"] = this.#auth.csrf;
    }
    return headers;
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof OpenRUMApiError) {
    if (error.code === "OBJECT_STORAGE_NOT_CONFIGURED") return false;
    return error.status >= 500 || error.status === 429;
  }
  // fetch rejects with a TypeError for DNS, connection and TLS failures.
  return error instanceof TypeError;
}

function isFatal(error: unknown): boolean {
  if (!(error instanceof OpenRUMApiError)) return false;
  return (
    error.status === 401 ||
    error.status === 403 ||
    error.status === 404 ||
    error.code === "OBJECT_STORAGE_NOT_CONFIGURED"
  );
}

function describeFailure(error: unknown, options: OpenRUMSourceMapOptions): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof OpenRUMApiError)) return message;
  const suffix = error.requestId ? ` (request ${error.requestId})` : "";
  switch (error.code) {
    case "ARTIFACT_EXISTS":
      return `a different Source Map with this name is already uploaded for release ${options.release}. Use a new release for a changed build, or set replace: true (--replace) to overwrite it${suffix}`;
    case "ARTIFACT_TOO_LARGE":
      return `${message}; split the bundle into smaller chunks${suffix}`;
    case "ARTIFACT_MISMATCH":
      return `${message}; the stored object did not match the declared size or SHA-256, run the upload again${suffix}`;
    case "OBJECT_STORAGE_NOT_CONFIGURED":
      return `${message}; ask an Instance administrator to configure object storage${suffix}`;
    case "OBJECT_STORAGE_UNAVAILABLE":
      return `${message}; object storage is configured but failing, retry later or ask an Instance administrator${suffix}`;
    case "INVALID_UPLOAD_TOKEN":
      return `${message}; the upload token is invalid or revoked, create a new one under Settings → Project → Onboarding${suffix}`;
    default:
      return `${message}${suffix}`;
  }
}

/** Normalizes a URL prefix to `a/b/` form: forward slashes, no leading slash, one trailing slash. */
export function normalizeUrlPrefix(value: string | undefined): string {
  if (!value) return "";
  const path = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .replace(/[?#].*$/, "")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
  return path ? `${path}/` : "";
}

async function findFiles(directory: string, match: (name: string) => boolean): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && match(entry.name)) output.push(path);
    }
  }
  await visit(directory);
  return output.sort();
}

const lineComment = /^[ \t]*\/\/[#@][ \t]*sourceMappingURL=[^\r\n]*(?:\r?\n|$)/gm;
const blockComment = /\/\*[#@][ \t]*sourceMappingURL=[\s\S]*?\*\/[ \t]*(?:\r?\n)?/g;

/** Removes `sourceMappingURL` comments so deployed files no longer reference removed maps. */
export function removeSourceMappingComments(source: string): string {
  return source.replace(lineComment, "").replace(blockComment, "");
}

async function stripSourceMappingComments(directory: string) {
  const files = await findFiles(directory, (name) => /\.(?:m?js|cjs|css)$/.test(name));
  await Promise.all(
    files.map(async (path) => {
      const source = await readFile(path, "utf8");
      if (!source.includes("sourceMappingURL=")) return;
      const stripped = removeSourceMappingComments(source);
      if (stripped !== source) await writeFile(path, stripped);
    }),
  );
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** Throws before any network call when the options cannot work; shared by the CLI and plugins. */
export function validateOptions(options: OpenRUMSourceMapOptions): Auth {
  const missing: string[] = [];
  if (!/^https?:\/\//.test(options.baseUrl ?? "")) missing.push("baseUrl (http or https URL)");
  if (!options.projectId) missing.push("projectId");
  if (!options.release) missing.push("release");
  if (missing.length) throw new Error(`OpenRUM Source Map options require ${missing.join(", ")}`);

  const token = options.token ?? process.env.OPENRUM_UPLOAD_TOKEN;
  if (token) return { kind: "token", token };
  if (options.sessionCookie && options.csrfToken)
    return { kind: "session", cookie: options.sessionCookie, csrf: options.csrfToken };
  throw new Error(
    "OpenRUM Source Map upload requires an upload token: pass `token` or set OPENRUM_UPLOAD_TOKEN. Create one in Settings → Project → Onboarding → Source Map upload tokens.",
  );
}
