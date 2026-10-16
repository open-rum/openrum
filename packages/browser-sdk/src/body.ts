import { scrubText } from "./privacy/scrub.ts";

/**
 * Body capture for API Requests: what is read, how it is redacted, how it is cut.
 *
 * A body is read only for an endpoint a project opted in to, and it is redacted here before it
 * is queued. The Consumer redacts it again and decides whether to store it at all, so this is
 * the first of two passes. The rules and the key list mirror internal/privacy/body.go, and the
 * tests on both sides use the same names.
 */

export const maxBodyChars = 4096;
/** Largest body read. JSON must be complete to be redacted by key, so larger is omitted. */
export const maxBodyReadChars = 64 * 1024;
export const truncatedMarker = "…[truncated]";
export const omittedBody = "[omitted: body larger than 64 KB]";
const redacted = "[REDACTED]";
const maxDepth = 24;

const sensitiveFragments = [
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "passwd",
  "passphrase",
  "apikey",
  "accesskey",
  "session",
  "csrf",
  "xsrf",
  "signature",
  "credential",
  "email",
  "phone",
  "creditcard",
  "cardnumber",
  "cvv",
  "ssn",
];

export function isSensitiveBodyKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_. ]/g, "");
  return sensitiveFragments.some((fragment) => normalized.includes(fragment));
}

// Fallbacks for text that is not complete JSON; they only see scalar values.
const jsonPair = /"([^"\\]{1,64})"\s*:\s*("(?:[^"\\]|\\.)*"|[^,}\]\s]+)/g;
const formBody = /^[^\s=&{}[\]<>]{1,64}=[^\s&]*(?:&[^\s=&{}[\]<>]{1,64}=[^\s&]*)*$/;

/**
 * Turns the text of a body into what may be queued: redacted and cut. Returns undefined for an
 * empty body, and the omitted marker for one too large to redact completely.
 */
export function prepareBody(raw: string): string | undefined {
  if (!raw) return undefined;
  if (raw.length > maxBodyReadChars) return omittedBody;
  const text = raw.trim();
  if (!text) return undefined;
  return cap(redactBody(text));
}

export function redactBody(text: string): string {
  if (text.startsWith("{") || text.startsWith("[")) {
    const structured = redactJSON(text);
    if (structured !== undefined) return structured;
    return redactLoose(text);
  }
  if (formBody.test(text)) return redactForm(text);
  return redactLoose(text);
}

function redactJSON(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const state = { changed: false };
  let result: unknown;
  try {
    result = redactValue(parsed, 0, state);
  } catch {
    return undefined;
  }
  // Untouched bodies keep their original text, so a clean response is shown as it was sent.
  return state.changed ? JSON.stringify(result) : text;
}

function redactValue(value: unknown, depth: number, state: { changed: boolean }): unknown {
  if (depth > maxDepth) throw new Error("too deep");
  if (typeof value === "string") {
    const scrubbed = scrubText(value);
    if (scrubbed !== value) state.changed = true;
    return scrubbed;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, state));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__") continue;
      if (isSensitiveBodyKey(key)) {
        result[key] = redacted;
        state.changed = true;
      } else {
        result[key] = redactValue(item, depth + 1, state);
      }
    }
    return result;
  }
  return value;
}

function redactForm(text: string): string {
  return text
    .split("&")
    .map((field) => {
      const separator = field.indexOf("=");
      const name = field.slice(0, separator);
      const value = field.slice(separator + 1);
      if (isSensitiveBodyKey(safeDecode(name))) return `${name}=${encodeURIComponent(redacted)}`;
      const decoded = safeDecode(value);
      const scrubbed = scrubText(decoded);
      return scrubbed === decoded ? field : `${name}=${encodeURIComponent(scrubbed)}`;
    })
    .join("&");
}

function redactLoose(text: string): string {
  return scrubText(text).replace(jsonPair, (pair, key: string, value: string) =>
    isSensitiveBodyKey(key) && value !== `"${redacted}"` ? `"${key}":"${redacted}"` : pair,
  );
}

function cap(text: string): string {
  if (text.length <= maxBodyChars) return text;
  let end = maxBodyChars;
  // Never end on half of a surrogate pair.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end) + truncatedMarker;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/** Whether a Content-Type describes something worth reading as text. */
export function isTextualContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return true;
  const type = contentType.toLowerCase();
  if (type.includes("event-stream")) return false;
  return type.startsWith("text/") || /json|xml|x-www-form-urlencoded|javascript|graphql/.test(type);
}
