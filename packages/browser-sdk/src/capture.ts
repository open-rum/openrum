import type { HeaderMap } from "@openrum/protocol";
import { matchesGlob } from "./filters.ts";
import { scrubText } from "./privacy/scrub.ts";

/**
 * Header capture for API Requests.
 *
 * Nothing is captured unless the project named an endpoint in the Console, and the
 * server decides what is stored: it keeps a header only when a rule names it for the
 * request's endpoint. This module is the browser's half. It reads the few headers a
 * rule lists, so an unlisted header never leaves the page and a project that opted in
 * to nothing costs no work at all.
 *
 * Settings that cannot be understood mean "capture nothing". That is the opposite of
 * how filters treat a bad document, and deliberate: a stale filter set is harmless,
 * while stale capture rules would keep reading headers a project had switched off.
 */

export interface CaptureRule {
  id: string;
  /** An HTTP method, or `*` for any. */
  method: string;
  /** Matched against the request URL; `*` is the only wildcard. */
  pattern: string;
  requestHeaders?: string[];
  responseHeaders?: string[];
  /** Opt in to a redacted, size-limited copy of the body, per direction. */
  requestBody?: boolean;
  responseBody?: boolean;
}

export interface CaptureSettings {
  rules?: CaptureRule[];
}

/** What may be read for one request: header names, and whether each body may be. */
export interface CaptureSelection {
  request: readonly string[];
  response: readonly string[];
  requestBody: boolean;
  responseBody: boolean;
}

export interface CompiledCapture {
  /** What to read for a request, or undefined when no rule applies. */
  select(method: string, url: string): CaptureSelection | undefined;
  /**
   * Every request header any rule lists. XMLHttpRequest offers no way to read a header
   * back, so the integration records these as they are set; it must record nothing else.
   */
  readonly requestNames: ReadonlySet<string>;
}

export const maxHeaders = 20;
export const maxHeaderValueLength = 256;
const maxHeaderNameLength = 64;
const maxRules = 20;
const maxPatternLength = 300;

// Matched the way the server matches them (case and separators ignored), so a name
// either side refuses is refused by both. The server list is authoritative; the same
// names are tested against it in internal/privacy.
const sensitiveFragments = [
  "auth",
  "cookie",
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "accesskey",
  "session",
  "csrf",
  "xsrf",
  "signature",
  "credential",
  "forwardedfor",
  "realip",
  "clientip",
  "email",
  "phone",
];

export function isSensitiveHeader(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[-_. ]/g, "");
  return sensitiveFragments.some((fragment) => normalized.includes(fragment));
}

export function isValidHeaderName(name: string): boolean {
  return name.length > 0 && name.length <= maxHeaderNameLength && /^[a-z0-9][a-z0-9-]*$/.test(name);
}

/**
 * Validates what arrives from the network. A document that is malformed in any rule is
 * discarded whole and yields no rules.
 */
export function parseCaptureSettings(value: unknown): CaptureSettings {
  if (!value || typeof value !== "object") return {};
  const rules = (value as { rules?: unknown }).rules;
  if (rules === undefined) return {};
  if (!Array.isArray(rules) || rules.length > maxRules) return {};
  const parsed: CaptureRule[] = [];
  for (const entry of rules) {
    const rule = parseRule(entry);
    if (!rule) return {};
    parsed.push(rule);
  }
  return { rules: parsed };
}

function parseRule(entry: unknown): CaptureRule | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const rule = entry as Record<string, unknown>;
  if (typeof rule.id !== "string" || !rule.id) return undefined;
  if (typeof rule.method !== "string" || !rule.method) return undefined;
  if (typeof rule.pattern !== "string" || !rule.pattern || rule.pattern.length > maxPatternLength)
    return undefined;
  const requestHeaders = parseNames(rule.requestHeaders);
  const responseHeaders = parseNames(rule.responseHeaders);
  if (!requestHeaders || !responseHeaders) return undefined;
  if (!optionalBoolean(rule.requestBody) || !optionalBoolean(rule.responseBody)) return undefined;
  return {
    id: rule.id,
    method: rule.method.toUpperCase(),
    pattern: rule.pattern,
    requestHeaders,
    responseHeaders,
    requestBody: rule.requestBody === true,
    responseBody: rule.responseBody === true,
  };
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "boolean";
}

function parseNames(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxHeaders) return undefined;
  const names: string[] = [];
  for (const name of value) {
    if (typeof name !== "string" || !isValidHeaderName(name) || isSensitiveHeader(name)) {
      return undefined;
    }
    names.push(name);
  }
  return names;
}

export function compileCapture(settings: CaptureSettings | undefined): CompiledCapture | undefined {
  const rules = settings?.rules ?? [];
  if (!rules.length) return undefined;
  const requestNames = new Set<string>();
  for (const rule of rules) for (const name of rule.requestHeaders ?? []) requestNames.add(name);

  return {
    requestNames,
    select(method, url) {
      const request: string[] = [];
      const response: string[] = [];
      let requestBody = false;
      let responseBody = false;
      for (const rule of rules) {
        if (rule.method !== "*" && rule.method !== method) continue;
        if (!matchesGlob(rule.pattern, url)) continue;
        for (const name of rule.requestHeaders ?? [])
          if (!request.includes(name)) request.push(name);
        for (const name of rule.responseHeaders ?? [])
          if (!response.includes(name)) response.push(name);
        requestBody ||= rule.requestBody === true;
        responseBody ||= rule.responseBody === true;
      }
      return request.length || response.length || requestBody || responseBody
        ? { request, response, requestBody, responseBody }
        : undefined;
    },
  };
}

/**
 * Reads the listed headers through `read` and returns a bounded, scrubbed snapshot.
 * Names that are sensitive or malformed are skipped even if a rule lists them, so a
 * document that slipped past validation still cannot make this read a credential.
 */
export function collectHeaders(
  names: readonly string[],
  read: (name: string) => string | null | undefined,
): HeaderMap | undefined {
  const headers: HeaderMap = {};
  let count = 0;
  for (const name of names) {
    if (count >= maxHeaders) break;
    if (!isValidHeaderName(name) || isSensitiveHeader(name)) continue;
    let value: string | null | undefined;
    try {
      value = read(name);
    } catch {
      // A throwing accessor must not break the host request.
      continue;
    }
    if (typeof value !== "string") continue;
    headers[name] = scrubText(value.trim()).slice(0, maxHeaderValueLength);
    count += 1;
  }
  return count ? headers : undefined;
}
