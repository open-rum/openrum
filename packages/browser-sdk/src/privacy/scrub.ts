import { sanitizeURL } from "./url.ts";

const MAX_ATTRIBUTES = 20;
const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 512;

const reservedKeys = new Set([
  "anonymous_user_id",
  "breadcrumbs",
  "environment",
  "event_id",
  "event_type",
  "page_id",
  "project_id",
  "release",
  "sample_rate",
  "schema_version",
  "session_id",
  "timestamp",
  "type",
  "user_id",
]);

const sensitiveKeyPattern =
  /(?:authorization|cookie|csrf|cvv|e-?mail|pass(?:word|phrase)?|phone|secret|session|token|credit.?card)/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const bearerPattern = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const cardPattern = /\b(?:\d[ -]*?){13,19}\b/g;

export interface AttributeDiagnostics {
  droppedAttributes: number;
}

export function sanitizeAttributes(
  input: unknown,
  diagnostics: AttributeDiagnostics,
): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    diagnostics.droppedAttributes += 1;
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const sanitized = sanitizeAttribute(key, value);
    if (!sanitized || Object.keys(result).length >= MAX_ATTRIBUTES) {
      diagnostics.droppedAttributes += 1;
      continue;
    }
    result[sanitized.key] = sanitized.value;
  }
  return Object.keys(result).length ? result : undefined;
}

export function sanitizeMeasurements(
  input: unknown,
  diagnostics: AttributeDiagnostics,
): Record<string, number> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    diagnostics.droppedAttributes += 1;
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      Object.keys(result).length >= MAX_ATTRIBUTES ||
      !isAllowedKey(key) ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      diagnostics.droppedAttributes += 1;
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

export function sanitizeAttribute(
  key: string,
  value: unknown,
): { key: string; value: string } | undefined {
  if (!isAllowedKey(key) || typeof value !== "string" || value.length > MAX_VALUE_LENGTH) {
    return undefined;
  }
  return { key, value: scrubText(value) };
}

export function sanitizeUserID(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (value.length > 128 || emailPattern.test(value)) {
    emailPattern.lastIndex = 0;
    return undefined;
  }
  emailPattern.lastIndex = 0;
  return value;
}

export function scrubText(value: string): string {
  const normalizedURL = /^https?:\/\//i.test(value) ? sanitizeURL(value) : undefined;
  const source = normalizedURL ?? value;
  return source
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(bearerPattern, "[REDACTED_TOKEN]")
    .replace(cardPattern, "[REDACTED_NUMBER]");
}

function isAllowedKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    key.length > 0 &&
    key.length <= MAX_KEY_LENGTH &&
    !reservedKeys.has(normalized) &&
    !sensitiveKeyPattern.test(normalized) &&
    normalized !== "__proto__" &&
    normalized !== "constructor" &&
    normalized !== "prototype" &&
    !normalized.startsWith("openrum.")
  );
}
