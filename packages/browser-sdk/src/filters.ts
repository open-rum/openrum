import type { EventContext, EventV1 } from "@openrum/protocol";

/**
 * Client-side inbound filtering.
 *
 * This is a bandwidth optimisation and nothing more. The consumer applies the
 * full rule set to everything it receives, so an SDK that is out of date, has a
 * stale cache, or ignores these settings entirely still produces correct data —
 * it just uploads events that are about to be discarded.
 *
 * Because of that asymmetry the rules here are applied conservatively. Dropping
 * an event the server would have kept is unrecoverable and invisible, while
 * keeping one the server will drop costs a single request. Anything uncertain
 * is therefore kept.
 */

export type FilterMode = "off" | "dry_run" | "enforced";

/**
 * Only the kinds a browser can evaluate against the same input the server uses.
 * The server omits the rest before sending, so an unknown kind arriving here
 * means the SDK is older than the server and must ignore it.
 */
export type FilterKind = "error_message" | "error_url" | "release";

export interface FilterRule {
  id: string;
  kind: FilterKind;
  pattern: string;
  mode: FilterMode;
}

export interface FilterSettings {
  builtin?: Record<string, FilterMode>;
  rules?: FilterRule[];
}

const extensionSchemes = [
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
  "safari-extension://",
  "ms-browser-extension://",
  "chrome-search://",
];

const maxRules = 50;
const maxPatternLength = 200;

/**
 * Matches a value against a pattern whose only metacharacter is `*`, using the
 * same rules as the server.
 *
 * Regular expressions are deliberately not supported. The server compiles these
 * patterns with RE2, which has no backtracking and rejects lookahead, while a
 * browser's RegExp accepts more syntax and can hang on a pattern that looks
 * harmless. One wildcard means the same thing in both places.
 */
export function matchesGlob(pattern: string, value: string): boolean {
  const segments = pattern.toLowerCase().split("*");
  const subject = value.toLowerCase();
  if (segments.length === 1) return subject === segments[0];

  const leading = segments[0];
  const trailing = segments[segments.length - 1];
  if (!subject.startsWith(leading)) return false;
  let rest = subject.slice(leading.length);
  for (const middle of segments.slice(1, -1)) {
    const index = rest.indexOf(middle);
    if (index < 0) return false;
    rest = rest.slice(index + middle.length);
  }
  // Checked against the remainder so `a*a` does not match a lone "a" by
  // letting one character satisfy both anchors.
  return rest.endsWith(trailing);
}

export interface CompiledFilters {
  /** Reports whether the event would be discarded by the server anyway. */
  shouldDrop(event: EventV1, context: EventContext): boolean;
}

export function compileFilters(settings: FilterSettings | undefined): CompiledFilters | undefined {
  if (!settings) return undefined;
  const dropExtension = settings.builtin?.extension === "enforced";
  const dropLocalhost = settings.builtin?.localhost === "enforced";
  const rules = (settings.rules ?? []).filter((rule) => rule.mode === "enforced");
  if (!dropExtension && !dropLocalhost && rules.length === 0) return undefined;

  return {
    shouldDrop(event, context) {
      if (dropExtension && isExtensionError(event)) return true;
      if (dropLocalhost && isLocalPage(context.page?.url)) return true;
      for (const rule of rules) {
        if (matchesRule(rule, event, context)) return true;
      }
      return false;
    },
  };
}

function matchesRule(rule: FilterRule, event: EventV1, context: EventContext): boolean {
  switch (rule.kind) {
    case "error_message": {
      if (event.type !== "error") return false;
      return matchesGlob(rule.pattern, errorTitle(event));
    }
    case "error_url": {
      if (event.type !== "error") return false;
      const stack = readError(event)?.stack;
      if (!stack) return false;
      // Matched per frame, so a pattern anchored at both ends behaves the way
      // its author expects rather than spanning the whole stack.
      return stack.split("\n").some((frame) => matchesGlob(rule.pattern, frame.trim()));
    }
    case "release":
      return matchesGlob(rule.pattern, context.release ?? "");
    default:
      // A kind this version does not know about is left to the server.
      return false;
  }
}

/** Renders the error the way the issue list and the server both do. */
function errorTitle(event: EventV1): string {
  const error = readError(event);
  const name = error?.name ?? "";
  const message = error?.message ?? "";
  if (!name) return message;
  if (!message) return name;
  return `${name}: ${message}`;
}

function readError(
  event: EventV1,
): { name?: string; message?: string; stack?: string } | undefined {
  const candidate = event as { error?: { name?: string; message?: string; stack?: string } };
  return candidate.error;
}

function isExtensionError(event: EventV1): boolean {
  if (event.type !== "error") return false;
  const error = readError(event);
  const stack = (error?.stack ?? "").toLowerCase();
  if (!stack) return false;
  return extensionSchemes.some((scheme) => stack.includes(scheme));
}

function isLocalPage(pageURL: string | undefined): boolean {
  if (!pageURL) return false;
  let hostname: string;
  try {
    hostname = new URL(pageURL).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return true;
  }
  // Bracketed IPv6 keeps its brackets in URL.hostname.
  const address = hostname.replace(/^\[|\]$/g, "");
  if (address === "::1") return true;
  if (/^127\./.test(address)) return true;
  // Link-local, which a machine assigns itself when no network hands it one.
  if (/^169\.254\./.test(address)) return true;
  return /^fe80:/i.test(address);
}

/**
 * Validates settings arriving from the network. A malformed document is
 * rejected whole rather than partially applied: a half-understood rule set
 * could discard more than the operator asked for, and the server enforces the
 * real rules regardless.
 */
export function parseFilterSettings(value: unknown): FilterSettings | undefined {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object") return undefined;
  const candidate = value as { builtin?: unknown; rules?: unknown };

  const settings: FilterSettings = {};
  if (candidate.builtin !== undefined) {
    if (typeof candidate.builtin !== "object" || candidate.builtin === null) return undefined;
    const builtin: Record<string, FilterMode> = {};
    for (const [reason, mode] of Object.entries(candidate.builtin as Record<string, unknown>)) {
      if (!isMode(mode)) return undefined;
      builtin[reason] = mode;
    }
    settings.builtin = builtin;
  }
  if (candidate.rules !== undefined) {
    if (!Array.isArray(candidate.rules) || candidate.rules.length > maxRules) return undefined;
    const rules: FilterRule[] = [];
    for (const entry of candidate.rules) {
      if (!entry || typeof entry !== "object") return undefined;
      const rule = entry as Record<string, unknown>;
      if (typeof rule.id !== "string" || !rule.id) return undefined;
      if (typeof rule.pattern !== "string" || !rule.pattern) return undefined;
      if (rule.pattern.length > maxPatternLength) return undefined;
      if (!isMode(rule.mode)) return undefined;
      if (typeof rule.kind !== "string") return undefined;
      rules.push({
        id: rule.id,
        kind: rule.kind as FilterKind,
        pattern: rule.pattern,
        mode: rule.mode,
      });
    }
    settings.rules = rules;
  }
  return settings;
}

function isMode(value: unknown): value is FilterMode {
  return value === "off" || value === "dry_run" || value === "enforced";
}
