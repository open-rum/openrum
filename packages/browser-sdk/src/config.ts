import type { ClientOptions } from "./client.ts";
import { parseFilterSettings, type FilterSettings } from "./filters.ts";
import type { SamplingOptions } from "./sampling.ts";

const maximumRefreshMs = 5 * 60 * 1000;
const minimumRefreshMs = 10 * 1000;

export interface SamplingTarget {
  updateSampling(options: Partial<SamplingOptions>): void;
  updateFilters(settings: FilterSettings | undefined): void;
}

export interface ConfigRuntime {
  fetch: typeof globalThis.fetch;
  location?: { href: string };
  localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

export interface RemoteSDKConfig extends SamplingOptions {
  version: number;
  effectiveAt: string;
  expiresAt: string;
  refreshAfterSeconds: number;
  emergency: boolean;
  /**
   * Carries only the rules the server decided a browser can evaluate against
   * the same input it uses. Absent means filter nothing here.
   */
  filters?: FilterSettings;
  emergencySampleRate?: number;
  emergencyExpiresAt?: string;
}

interface CachedConfig {
  config: RemoteSDKConfig;
}

export function resolveConfigEndpoint(
  ingestEndpoint: string,
  configured: string | false | undefined,
  locationHref?: string,
): string | undefined {
  if (configured === false) return undefined;
  if (typeof configured === "string" && configured) return configured;
  try {
    return new URL("/api/v1/sdk/config", new URL(ingestEndpoint, locationHref)).toString();
  } catch {
    return undefined;
  }
}

export function startRemoteConfig(
  target: SamplingTarget,
  options: Pick<ClientOptions, "writeKey" | "endpoint" | "configEndpoint">,
  runtime: ConfigRuntime | undefined = browserRuntime(),
): () => void {
  const endpoint = resolveConfigEndpoint(
    options.endpoint,
    options.configEndpoint,
    runtime?.location?.href,
  );
  if (!runtime || !endpoint) return () => undefined;
  const now = runtime.now ?? Date.now;
  const schedule = runtime.setTimeout ?? globalThis.setTimeout;
  const cancel = runtime.clearTimeout ?? globalThis.clearTimeout;
  const storageKey = `openrum:sdk-config:${hashKey(endpoint, options.writeKey)}`;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: RemoteSDKConfig | undefined = readCache(runtime.localStorage, storageKey, now());

  const apply = (config: RemoteSDKConfig, timestamp: number) => {
    const emergencyExpiry = config.emergencyExpiresAt ? Date.parse(config.emergencyExpiresAt) : 0;
    const cap =
      config.emergency && emergencyExpiry > timestamp ? config.emergencySampleRate : undefined;
    target.updateSampling({
      eventSampleRate:
        cap === undefined ? config.eventSampleRate : Math.min(config.eventSampleRate, cap),
      apiSampleRate: cap === undefined ? config.apiSampleRate : Math.min(config.apiSampleRate, cap),
      errorSampleRate:
        cap === undefined ? config.errorSampleRate : Math.min(config.errorSampleRate, cap),
    });
    target.updateFilters(config.filters);
  };

  const queue = (config: RemoteSDKConfig | undefined) => {
    if (stopped) return;
    const timestamp = now();
    const requested = config ? config.refreshAfterSeconds * 1000 : maximumRefreshMs;
    let delay = Math.min(maximumRefreshMs, Math.max(minimumRefreshMs, requested));
    if (config?.emergencyExpiresAt) {
      const untilExpiry = Date.parse(config.emergencyExpiresAt) - timestamp;
      if (untilExpiry > 0) delay = Math.min(delay, Math.max(1, untilExpiry));
    }
    timer = schedule(() => void refresh(), delay);
  };

  const refresh = async () => {
    try {
      const response = await runtime.fetch(endpoint, {
        method: "GET",
        credentials: "omit",
        headers: { "X-OpenRUM-Key": options.writeKey },
      });
      if (!response.ok) return;
      const next = parseRemoteConfig(await response.json());
      if (!next || (current && next.version < current.version)) return;
      current = next;
      writeCache(runtime.localStorage, storageKey, next);
    } catch {
      // Keep the last known safe configuration or the local SDK defaults.
    } finally {
      if (current) apply(current, now());
      queue(current);
    }
  };

  if (current) apply(current, now());
  void refresh();
  return () => {
    stopped = true;
    if (timer !== undefined) cancel(timer);
  };
}

export function parseRemoteConfig(value: unknown): RemoteSDKConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.version) || (candidate.version as number) < 1)
    return undefined;
  if (!validTimestamp(candidate.effectiveAt) || !validTimestamp(candidate.expiresAt))
    return undefined;
  if (
    !validRate(candidate.eventSampleRate) ||
    !validRate(candidate.apiSampleRate) ||
    !validRate(candidate.errorSampleRate)
  )
    return undefined;
  if (
    typeof candidate.refreshAfterSeconds !== "number" ||
    !Number.isFinite(candidate.refreshAfterSeconds) ||
    candidate.refreshAfterSeconds <= 0
  )
    return undefined;
  if (typeof candidate.emergency !== "boolean") return undefined;
  // A filter document that cannot be read invalidates the whole response. The
  // alternative — applying the sampling half and silently ignoring the rules —
  // would leave the SDK in a state the operator never configured.
  const filters = parseFilterSettings(candidate.filters);
  if (filters === undefined) return undefined;
  if (
    candidate.emergency &&
    (!validRate(candidate.emergencySampleRate) || !validTimestamp(candidate.emergencyExpiresAt))
  )
    return undefined;
  return { ...(candidate as unknown as RemoteSDKConfig), filters };
}

function readCache(
  storage: ConfigRuntime["localStorage"],
  key: string,
  now: number,
): RemoteSDKConfig | undefined {
  if (!storage) return undefined;
  try {
    const cached = JSON.parse(storage.getItem(key) ?? "null") as CachedConfig | null;
    const config = cached?.config && parseRemoteConfig(cached.config);
    if (config && Date.parse(config.expiresAt) > now) return config;
    storage.removeItem(key);
  } catch {
    // Storage may be unavailable in privacy mode.
  }
  return undefined;
}

function writeCache(
  storage: ConfigRuntime["localStorage"],
  key: string,
  config: RemoteSDKConfig,
): void {
  try {
    storage?.setItem(key, JSON.stringify({ config } satisfies CachedConfig));
  } catch {
    // Remote configuration must never break telemetry initialization.
  }
}

function validRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hashKey(endpoint: string, key: string): string {
  let hash = 0x811c9dc5;
  for (const character of `${endpoint}\u0000${key}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function browserRuntime(): ConfigRuntime | undefined {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return undefined;
  return window;
}
