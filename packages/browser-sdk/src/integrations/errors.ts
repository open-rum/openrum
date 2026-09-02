import type { Integration, OpenRUMClient } from "../client.ts";

const MAX_NAME = 128;
const MAX_MESSAGE = 2_048;
const MAX_STACK = 65_536;

export interface ErrorRuntime {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, options?: EventListenerOptions): void;
}

interface ErrorLikeEvent extends Event {
  error?: unknown;
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  target: EventTarget | null;
}

interface RejectionLikeEvent extends Event {
  reason?: unknown;
}

export function errorIntegration(
  runtime: ErrorRuntime | undefined = browserRuntime(),
): Integration {
  return {
    name: "runtime-errors",
    setup(client) {
      if (!runtime) return;
      const onError: EventListener = (event) => captureWindowError(client, event as ErrorLikeEvent);
      const onUnhandledRejection: EventListener = (event) =>
        captureRejection(client, event as RejectionLikeEvent);
      runtime.addEventListener("error", onError, { capture: true });
      runtime.addEventListener("unhandledrejection", onUnhandledRejection);
      return () => {
        runtime.removeEventListener("error", onError, { capture: true });
        runtime.removeEventListener("unhandledrejection", onUnhandledRejection);
      };
    },
  };
}

function captureWindowError(client: OpenRUMClient, event: ErrorLikeEvent): void {
  try {
    const details = readError(event.error);
    const resource = details ? undefined : resourceDescription(event.target);
    const message = details?.message || event.message || resource || "Unknown browser error";
    const location = event.filename
      ? ` (${safeResourceURL(event.filename)}:${event.lineno ?? 0}:${event.colno ?? 0})`
      : "";
    client.capture({
      type: "error",
      error: {
        name: bounded(details?.name || (resource ? "ResourceError" : "Error"), MAX_NAME),
        message: bounded(message + location, MAX_MESSAGE),
        ...(details?.stack ? { stack: bounded(details.stack, MAX_STACK) } : {}),
        handled: false,
        mechanism: resource ? "resource" : "window.onerror",
      },
    });
  } catch {
    // Never interfere with the browser's own error dispatch.
  }
}

function captureRejection(client: OpenRUMClient, event: RejectionLikeEvent): void {
  try {
    const details = readError(event.reason);
    client.capture({
      type: "error",
      error: {
        name: bounded(details?.name || "UnhandledRejection", MAX_NAME),
        message: bounded(details?.message || stringifyReason(event.reason), MAX_MESSAGE),
        ...(details?.stack ? { stack: bounded(details.stack, MAX_STACK) } : {}),
        handled: false,
        mechanism: "unhandledrejection",
      },
    });
  } catch {
    // Rejection reasons may be proxies with throwing property getters.
  }
}

function readError(
  value: unknown,
): { name?: string; message?: string; stack?: string } | undefined {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try {
    const candidate = value as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
      ...(typeof candidate.message === "string" ? { message: candidate.message } : {}),
      ...(typeof candidate.stack === "string" ? { stack: candidate.stack } : {}),
    };
  } catch {
    return undefined;
  }
}

function stringifyReason(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "Promise rejected without a reason";
  try {
    const seen = new WeakSet<object>();
    return (
      JSON.stringify(value, (_key, candidate: unknown) => {
        if (candidate && typeof candidate === "object") {
          if (seen.has(candidate)) return "[Circular]";
          seen.add(candidate);
        }
        return candidate;
      }) ?? String(value)
    );
  } catch {
    try {
      return String(value);
    } catch {
      return "Unserializable rejection reason";
    }
  }
}

function resourceDescription(target: EventTarget | null | undefined): string | undefined {
  if (!target || typeof target !== "object") return undefined;
  try {
    const element = target as { tagName?: unknown; src?: unknown; href?: unknown };
    if (typeof element.tagName !== "string") return undefined;
    const resource = typeof element.src === "string" ? element.src : element.href;
    const safeResource = typeof resource === "string" ? safeResourceURL(resource) : "";
    return `Failed to load ${element.tagName.toLowerCase()}${safeResource ? `: ${safeResource}` : ""}`;
  } catch {
    return undefined;
  }
}

function safeResourceURL(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? "";
  }
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function browserRuntime(): ErrorRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  return window;
}
