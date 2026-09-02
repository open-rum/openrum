import type { Integration } from "../client.ts";
import { captureRequest, durationSince, normalizeMethod } from "./fetch.ts";
import { isIngestURL, sanitizeURL } from "../privacy/url.ts";

interface XHRLike extends EventTarget {
  status: number;
  getResponseHeader(name: string): string | null;
}

interface XHRPrototype {
  open(method: string, url: string | URL, ...rest: unknown[]): unknown;
  send(body?: unknown): unknown;
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
}

export function xhrIntegration(
  endpoint: string,
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

      function send(this: XHRLike, body?: unknown) {
        const details = requests.get(this);
        if (
          !details?.method ||
          !details.url ||
          isIngestURL(details.rawURL, endpoint, xhrRuntime.location?.href)
        ) {
          return originalSend.call(this, body);
        }
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
      return () => {
        if (prototype.open === open) prototype.open = originalOpen;
        if (prototype.send === send) prototype.send = originalSend;
      };
    },
  };
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
