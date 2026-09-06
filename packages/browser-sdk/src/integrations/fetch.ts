import type { APIEvent } from "@openrum/protocol";
import type { Integration, OpenRUMClient } from "../client.ts";
import { isIngestURL, sanitizeURL } from "../privacy/url.ts";

type APIMethod = APIEvent["request"]["method"];
type APIFailure = NonNullable<APIEvent["request"]["failure"]>;

export interface FetchRuntime {
  fetch: typeof globalThis.fetch;
  location?: { href: string };
  now?: () => number;
}

export function fetchIntegration(
  endpoint: string | readonly string[],
  runtime: FetchRuntime | undefined = browserRuntime(),
): Integration {
  return {
    name: "fetch",
    setup(client) {
      if (!runtime || typeof runtime.fetch !== "function") return;
      const fetchRuntime = runtime;
      const originalFetch = fetchRuntime.fetch;
      const now = fetchRuntime.now ?? monotonicNow;

      async function instrumentedFetch(
        this: unknown,
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const details = readRequest(input, init, fetchRuntime.location?.href);
        if (!details || excluded(details.rawURL, endpoint, fetchRuntime.location?.href)) {
          return originalFetch.apply(this, [input, init]);
        }
        const startedAt = now();
        try {
          const response = await originalFetch.apply(this, [input, init]);
          captureRequest(client, {
            method: details.method,
            url: details.url,
            status: boundedStatus(response.status),
            duration: durationSince(startedAt, now()),
            transferSize: readContentLength(response.headers),
            failure: response.status >= 500 ? "http" : undefined,
          });
          return response;
        } catch (error) {
          captureRequest(client, {
            method: details.method,
            url: details.url,
            duration: durationSince(startedAt, now()),
            failure: classifyFailure(error),
          });
          throw error;
        }
      }

      fetchRuntime.fetch = instrumentedFetch;
      return () => {
        if (fetchRuntime.fetch === instrumentedFetch) fetchRuntime.fetch = originalFetch;
      };
    },
  };
}

function excluded(
  rawURL: string | URL,
  endpoints: string | readonly string[],
  base?: string,
): boolean {
  return (typeof endpoints === "string" ? [endpoints] : endpoints).some((endpoint) =>
    isIngestURL(rawURL, endpoint, base),
  );
}

interface RequestDetails {
  method: APIMethod;
  rawURL: string | URL;
  url: string;
}

function readRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  base: string | undefined,
): RequestDetails | undefined {
  try {
    const rawURL = input instanceof Request ? input.url : input;
    const url = sanitizeURL(rawURL, base);
    const method = normalizeMethod(
      init?.method ?? (input instanceof Request ? input.method : "GET"),
    );
    return url && method ? { method, rawURL, url } : undefined;
  } catch {
    return undefined;
  }
}

interface RequestCapture {
  method: APIMethod;
  url: string;
  status?: number;
  duration: number;
  transferSize?: number;
  failure?: APIFailure;
}

export function captureRequest(client: OpenRUMClient, capture: RequestCapture): void {
  try {
    client.capture({
      type: "api",
      request: {
        method: capture.method,
        url: capture.url,
        ...(capture.status !== undefined ? { status: capture.status } : {}),
        duration_ms: capture.duration,
        ...(capture.transferSize !== undefined ? { transfer_size: capture.transferSize } : {}),
        ...(capture.failure ? { failure: capture.failure } : {}),
      },
    });
  } catch {
    // Network instrumentation must preserve the host request outcome.
  }
}

export function normalizeMethod(value: string): APIMethod | undefined {
  const method = value.toUpperCase();
  if (
    method === "GET" ||
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE" ||
    method === "HEAD" ||
    method === "OPTIONS"
  ) {
    return method;
  }
  return undefined;
}

export function classifyFailure(error: unknown): APIFailure {
  try {
    const name = (error as { name?: unknown })?.name;
    if (name === "AbortError") return "abort";
    if (name === "TimeoutError") return "timeout";
  } catch {
    // Throwing proxies are treated as generic network failures.
  }
  return "network";
}

export function durationSince(startedAt: number, finishedAt: number): number {
  return Math.min(3_600_000, Math.max(0, finishedAt - startedAt));
}

export function readContentLength(headers: Headers): number | undefined {
  try {
    const value = headers.get("content-length");
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function boundedStatus(status: number): number {
  return Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0;
}

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function browserRuntime(): FetchRuntime | undefined {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return undefined;
  return window;
}
