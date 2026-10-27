import type { Integration } from "../client.ts";

const DEFAULT_MAX_CLICKS_PER_MINUTE = 60;
const INTERACTIVE_SELECTOR =
  "a,button,input,select,textarea,summary,[role='button'],[role='link'],[data-openrum-name]";
const allowedTags = new Set(["a", "button", "input", "select", "textarea", "summary"]);
const allowedRoles = new Set(["button", "link", "menuitem", "tab"]);
const allowedInputTypes = new Set(["button", "checkbox", "radio", "reset", "submit", "file"]);

export interface BehaviorElement {
  tagName?: string;
  parentElement?: BehaviorElement | null;
  closest?(selector: string): BehaviorElement | null;
  getAttribute?(name: string): string | null;
}

// A click names where it happened with a short CSS path, such as
// `div.experiment-grid > article.experiment-card > button.run-button`. Only names that look
// written by a developer survive: an id or class with a digit is usually generated or carries
// data (`user-42`, `css-1x9f2`), so it is left out rather than reported.
const SELECTOR_DEPTH = 3;
const SELECTOR_CLASSES = 3;
const SELECTOR_MAX_LENGTH = 200;
const selectorToken = /^[A-Za-z_-][A-Za-z_-]{0,39}$/;

export interface BehaviorRuntime {
  addEventListener(type: "click", listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: "click", listener: EventListener, options?: EventListenerOptions): void;
}

export interface BehaviorIntegrationOptions {
  maxClicksPerMinute?: number;
  now?: () => number;
}

export function behaviorIntegration(
  runtime: BehaviorRuntime | undefined = browserRuntime(),
  options: BehaviorIntegrationOptions = {},
): Integration {
  return {
    name: "behavior",
    setup(client) {
      if (!runtime) return;
      const maxClicks = normalizeLimit(options.maxClicksPerMinute);
      const now = options.now ?? Date.now;
      let windowStartedAt = now();
      let clicksInWindow = 0;

      const onClick: EventListener = (event) => {
        const currentTime = now();
        if (currentTime - windowStartedAt >= 60_000) {
          windowStartedAt = currentTime;
          clicksInWindow = 0;
        }
        if (clicksInWindow >= maxClicks) return;

        const attributes = describeTarget(event.target as BehaviorElement | null);
        if (!attributes) return;
        clicksInWindow += 1;
        client.captureEvent("ui.click", { attributes });
      };

      runtime.addEventListener("click", onClick, { capture: true, passive: true });
      return () => runtime.removeEventListener("click", onClick, { capture: true });
    },
  };
}

export function describeTarget(origin: BehaviorElement | null): Record<string, string> | undefined {
  const target = origin?.closest?.(INTERACTIVE_SELECTOR) ?? origin;
  if (!target?.getAttribute) return undefined;

  const tag = target.tagName?.toLowerCase();
  const role = normalizedToken(target.getAttribute("role"), allowedRoles);
  const explicitName = normalizedExplicitName(target.getAttribute("data-openrum-name"));
  if (!tag || (!allowedTags.has(tag) && !role && !explicitName)) return undefined;

  const result: Record<string, string> = { element: allowedTags.has(tag) ? tag : "custom" };
  if (role) result.role = role;
  if (explicitName) result.name = explicitName;
  if (tag === "input") {
    const inputType = normalizedToken(target.getAttribute("type") || "text", allowedInputTypes);
    if (inputType) result.input_type = inputType;
  }
  const selector = selectorPath(target);
  if (selector) result.selector = selector;
  return result;
}

/** The clicked element and up to two ancestors, as `tag#id.class > tag.class`. */
export function selectorPath(target: BehaviorElement): string | undefined {
  const parts: string[] = [];
  let node: BehaviorElement | null | undefined = target;
  while (node && parts.length < SELECTOR_DEPTH) {
    const tag = node.tagName?.toLowerCase();
    if (!tag || tag === "html" || tag === "body" || !/^[a-z][a-z0-9-]*$/.test(tag)) break;
    const id = node.getAttribute?.("id")?.trim();
    const classes = (node.getAttribute?.("class") ?? "")
      .split(/\s+/)
      .filter((name) => selectorToken.test(name))
      .slice(0, SELECTOR_CLASSES);
    parts.unshift(
      tag +
        (id && selectorToken.test(id) ? `#${id}` : "") +
        classes.map((name) => `.${name}`).join(""),
    );
    node = node.parentElement;
  }
  while (parts.length > 1 && parts.join(" > ").length > SELECTOR_MAX_LENGTH) parts.shift();
  const selector = parts.join(" > ");
  return selector && selector.length <= SELECTOR_MAX_LENGTH ? selector : undefined;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return DEFAULT_MAX_CLICKS_PER_MINUTE;
  return Math.max(1, Math.min(300, Math.floor(value)));
}

function normalizedToken(value: string | null, allowed: Set<string>): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && allowed.has(normalized) ? normalized : undefined;
}

function normalizedExplicitName(value: string | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 64 || /[\r\n\0]/.test(normalized)) return undefined;
  return normalized;
}

function browserRuntime(): BehaviorRuntime | undefined {
  if (typeof document === "undefined") return undefined;
  return document;
}
