import type { APIEvent, HeaderMap } from "@openrum/protocol";
import type { Integration, OpenRUMClient } from "../client.ts";
import { collectHeaders } from "../capture.ts";
import { isTextualContentType, maxBodyReadChars, omittedBody, prepareBody } from "../body.ts";
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
        // Asked once, before the request: the rules in force when it started decide, and a
        // project with no rule gets undefined here and pays nothing further.
        const selection = client.captureSelection(details.method, details.url);
        // A Request's body can only be copied before it is sent.
        const requestBody = selection?.requestBody ? startRequestBody(input, init) : undefined;
        const startedAt = now();
        try {
          const response = await originalFetch.apply(this, [input, init]);
          const capture: RequestCapture = {
            method: details.method,
            url: details.url,
            status: boundedStatus(response.status),
            duration: durationSince(startedAt, now()),
            transferSize: readContentLength(response.headers),
            failure: response.status >= 500 ? "http" : undefined,
            requestHeaders: selection && readRequestHeaders(input, init, selection.request),
            responseHeaders:
              selection && collectHeaders(selection.response, (name) => response.headers.get(name)),
          };
          if (selection?.requestBody || selection?.responseBody) {
            // Copied now, read later: the page gets its response at once and the event follows
            // when the bodies have been read. The copy is what keeps the page's body intact.
            const responseCopy = selection.responseBody ? copyResponse(response) : undefined;
            void finishWithBodies(client, capture, requestBody, responseCopy);
          } else {
            captureRequest(client, capture);
          }
          return response;
        } catch (error) {
          const capture: RequestCapture = {
            method: details.method,
            url: details.url,
            duration: durationSince(startedAt, now()),
            failure: classifyFailure(error),
            requestHeaders: selection && readRequestHeaders(input, init, selection.request),
          };
          if (selection?.requestBody)
            void finishWithBodies(client, capture, requestBody, undefined);
          else captureRequest(client, capture);
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

/** Longest time spent reading a body; a stalled stream must not hold an event back for long. */
const bodyReadTimeoutMs = 3_000;

async function finishWithBodies(
  client: OpenRUMClient,
  capture: RequestCapture,
  requestBody: BodySource | undefined,
  responseCopy: Response | undefined,
): Promise<void> {
  try {
    const [requestText, responseText] = await Promise.all([
      requestBody,
      responseCopy ? readBodyText(responseCopy) : undefined,
    ]);
    const request = requestText ? prepareBody(requestText) : undefined;
    const response = responseText ? prepareBody(responseText) : undefined;
    capture = {
      ...capture,
      ...(request ? { requestBody: request } : {}),
      ...(response ? { responseBody: response } : {}),
    };
  } catch {
    // The event is still worth sending without the bodies.
  }
  captureRequest(client, capture);
}

type BodySource = string | Promise<string | undefined>;

/**
 * The request body as text, when it is text: a string or URLSearchParams passed to fetch, or the
 * body of a Request object. Blobs, FormData, buffers and streams are not read.
 */
function startRequestBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): BodySource | undefined {
  try {
    if (init?.body !== undefined && init.body !== null) {
      if (typeof init.body === "string") return init.body;
      if (typeof URLSearchParams !== "undefined" && init.body instanceof URLSearchParams) {
        return init.body.toString();
      }
      return undefined;
    }
    if (input instanceof Request && !input.bodyUsed && input.body) {
      return readBodyText(input.clone());
    }
  } catch {
    // An unreadable body is simply not captured.
  }
  return undefined;
}

function copyResponse(response: Response): Response | undefined {
  try {
    return response.bodyUsed || !response.body ? undefined : response.clone();
  } catch {
    return undefined;
  }
}

/**
 * Reads a copy of a body as text, stopping early. A body larger than the limit is reported as
 * omitted, never cut, because a cut JSON document cannot be redacted by key.
 */
async function readBodyText(source: Request | Response): Promise<string | undefined> {
  try {
    if (!isTextualContentType(source.headers.get("content-type"))) return undefined;
    const declared = Number(source.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBodyReadChars) {
      void source.body?.cancel().catch(() => undefined);
      return omittedBody;
    }
    const reader = source.body?.getReader();
    if (!reader) return undefined;
    const timeout = setTimeout(
      () => void reader.cancel().catch(() => undefined),
      bodyReadTimeoutMs,
    );
    try {
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.length > maxBodyReadChars) {
          void reader.cancel().catch(() => undefined);
          return omittedBody;
        }
      }
      return text + decoder.decode();
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return undefined;
  }
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
  requestHeaders?: HeaderMap;
  responseHeaders?: HeaderMap;
  /** Already redacted and cut; see prepareBody. */
  requestBody?: string;
  responseBody?: string;
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
        ...(capture.requestHeaders ? { request_headers: capture.requestHeaders } : {}),
        ...(capture.responseHeaders ? { response_headers: capture.responseHeaders } : {}),
        ...(capture.requestBody ? { request_body: capture.requestBody } : {}),
        ...(capture.responseBody ? { response_body: capture.responseBody } : {}),
      },
    });
  } catch {
    // Network instrumentation must preserve the host request outcome.
  }
}

/**
 * The headers a fetch call sends: the init's if it has any, otherwise the Request's. That
 * is the rule fetch itself applies, so this reports what actually went out. Only the
 * names a rule lists are read.
 */
function readRequestHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  names: readonly string[],
): HeaderMap | undefined {
  if (!names.length) return undefined;
  try {
    const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (!source) return undefined;
    const headers = new Headers(source);
    return collectHeaders(names, (name) => headers.get(name));
  } catch {
    return undefined;
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
