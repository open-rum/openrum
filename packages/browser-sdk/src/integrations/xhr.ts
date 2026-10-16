import type { HeaderMap } from "@openrum/protocol";
import type { Integration } from "../client.ts";
import { collectHeaders, type CaptureSelection } from "../capture.ts";
import { isTextualContentType, maxBodyReadChars, omittedBody, prepareBody } from "../body.ts";
import { captureRequest, durationSince, normalizeMethod } from "./fetch.ts";
import { isIngestURL, sanitizeURL } from "../privacy/url.ts";

interface XHRLike extends EventTarget {
  status: number;
  responseType?: string;
  responseText?: string;
  response?: unknown;
  getResponseHeader(name: string): string | null;
}

interface XHRPrototype {
  open(method: string, url: string | URL, ...rest: unknown[]): unknown;
  send(body?: unknown): unknown;
  setRequestHeader?(name: string, value: string): unknown;
}

export interface XHRRuntime {
  XMLHttpRequest: { prototype: XHRPrototype };
  location?: { href: string };
  now?: () => number;
}

interface XHRRequest {
  method?: ReturnType<typeof normalizeMethod>;
  rawURL: string | URL;
  url?: string;
  /** Only names a capture rule lists; see setRequestHeader below. */
  requestHeaders?: Record<string, string>;
}

export function xhrIntegration(
  endpoint: string | readonly string[],
  runtime: XHRRuntime | undefined = browserRuntime(),
): Integration {
  return {
    name: "xhr",
    setup(client) {
      if (!runtime?.XMLHttpRequest?.prototype) return;
      const xhrRuntime = runtime;
      const prototype = xhrRuntime.XMLHttpRequest.prototype;
      const originalOpen = prototype.open;
      const originalSend = prototype.send;
      const originalSetRequestHeader = prototype.setRequestHeader;
      const requests = new WeakMap<object, XHRRequest>();
      const now = xhrRuntime.now ?? monotonicNow;

      function open(this: object, method: string, url: string | URL, ...rest: unknown[]) {
        requests.set(this, {
          method: normalizeMethod(method),
          rawURL: url,
          url: sanitizeURL(url, xhrRuntime.location?.href),
        });
        return originalOpen.call(this, method, url, ...rest);
      }

      // A request header cannot be read back from an XMLHttpRequest, so it has to be seen as
      // it is set. Only names a capture rule lists are kept, in memory, until the request
      // finishes; with no rules the set is empty and nothing is retained.
      function setRequestHeader(this: object, name: string, value: string) {
        try {
          const wanted = client.capturableRequestHeaders();
          const key = String(name).toLowerCase();
          const details = requests.get(this);
          if (details && wanted.has(key)) {
            const recorded = (details.requestHeaders ??= {});
            // Repeated calls combine, which is what the browser sends.
            recorded[key] =
              recorded[key] === undefined ? String(value) : `${recorded[key]}, ${value}`;
          }
        } catch {
          // Recording must never change what the page's request does.
        }
        return originalSetRequestHeader!.call(this, name, value);
      }

      function send(this: XHRLike, body?: unknown) {
        const details = requests.get(this);
        if (
          !details?.method ||
          !details.url ||
          (typeof endpoint === "string" ? [endpoint] : endpoint).some((value) =>
            isIngestURL(details.rawURL, value, xhrRuntime.location?.href),
          )
        ) {
          return originalSend.call(this, body);
        }
        const selection = client.captureSelection(details.method, details.url);
        // Taken now: the body is only available as an argument to send().
        const requestText = selection?.requestBody ? textOfBody(body) : undefined;
        const startedAt = now();
        let failure: "network" | "timeout" | "abort" | undefined;
        let complete = false;
        const onError = () => {
          failure = "network";
        };
        const onTimeout = () => {
          failure = "timeout";
        };
        const onAbort = () => {
          failure = "abort";
        };
        const onLoadEnd = () => finish();
        const finish = (synchronousFailure?: "network") => {
          if (complete) return;
          complete = true;
          removeListeners();
          const status = readStatus(this);
          const transferSize = readTransferSize(this);
          captureRequest(client, {
            method: details.method!,
            url: details.url!,
            ...(status !== undefined ? { status } : {}),
            duration: durationSince(startedAt, now()),
            ...(failure || synchronousFailure
              ? { failure: failure ?? synchronousFailure }
              : status !== undefined && status >= 500
                ? { failure: "http" }
                : {}),
            ...(transferSize !== undefined ? { transferSize } : {}),
            ...headerCapture(selection, details, this, requestText),
          });
        };
        const removeListeners = () => {
          this.removeEventListener("error", onError);
          this.removeEventListener("timeout", onTimeout);
          this.removeEventListener("abort", onAbort);
          this.removeEventListener("loadend", onLoadEnd);
        };
        this.addEventListener("error", onError);
        this.addEventListener("timeout", onTimeout);
        this.addEventListener("abort", onAbort);
        this.addEventListener("loadend", onLoadEnd);
        try {
          return originalSend.call(this, body);
        } catch (error) {
          finish("network");
          throw error;
        }
      }

      prototype.open = open;
      prototype.send = send;
      if (originalSetRequestHeader) prototype.setRequestHeader = setRequestHeader;
      return () => {
        if (prototype.open === open) prototype.open = originalOpen;
        if (prototype.send === send) prototype.send = originalSend;
        if (originalSetRequestHeader && prototype.setRequestHeader === setRequestHeader) {
          prototype.setRequestHeader = originalSetRequestHeader;
        }
      };
    },
  };
}

function headerCapture(
  selection: CaptureSelection | undefined,
  details: XHRRequest,
  xhr: XHRLike,
  requestText: string | undefined,
): {
  requestHeaders?: HeaderMap;
  responseHeaders?: HeaderMap;
  requestBody?: string;
  responseBody?: string;
} {
  if (!selection) return {};
  const requestHeaders = details.requestHeaders
    ? collectHeaders(selection.request, (name) => details.requestHeaders?.[name])
    : undefined;
  const responseHeaders = collectHeaders(selection.response, (name) => xhr.getResponseHeader(name));
  const requestBody = requestText ? prepareBody(requestText) : undefined;
  const responseText = selection.responseBody ? readResponseText(xhr) : undefined;
  const responseBody = responseText ? prepareBody(responseText) : undefined;
  return {
    ...(requestHeaders ? { requestHeaders } : {}),
    ...(responseHeaders ? { responseHeaders } : {}),
    ...(requestBody ? { requestBody } : {}),
    ...(responseBody ? { responseBody } : {}),
  };
}

/** The request body as text, when it is text. Blobs, FormData and buffers are not read. */
function textOfBody(body: unknown): string | undefined {
  if (typeof body === "string") return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return body.toString();
  }
  return undefined;
}

/**
 * The response as text, for the response types that have one. A body larger than the read limit
 * is reported as omitted rather than cut, so it can be redacted completely or not at all.
 */
function readResponseText(xhr: XHRLike): string | undefined {
  try {
    if (!isTextualContentType(xhr.getResponseHeader("content-type"))) return undefined;
    const type = xhr.responseType ?? "";
    let text: string | undefined;
    if (type === "" || type === "text") text = xhr.responseText;
    else if (type === "json" && xhr.response !== null && xhr.response !== undefined) {
      text = JSON.stringify(xhr.response);
    }
    if (text === undefined) return undefined;
    return text.length > maxBodyReadChars ? omittedBody : text;
  } catch {
    return undefined;
  }
}

function readStatus(xhr: XHRLike): number | undefined {
  try {
    return Number.isInteger(xhr.status) && xhr.status >= 0 && xhr.status <= 599
      ? xhr.status
      : undefined;
  } catch {
    return undefined;
  }
}

function readTransferSize(xhr: XHRLike): number | undefined {
  try {
    const value = xhr.getResponseHeader("content-length");
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function browserRuntime(): XHRRuntime | undefined {
  if (typeof window === "undefined" || typeof XMLHttpRequest === "undefined") return undefined;
  return window as unknown as XHRRuntime;
}
