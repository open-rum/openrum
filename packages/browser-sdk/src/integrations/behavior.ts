import type { Integration } from "../client.ts";

const DEFAULT_MAX_CLICKS_PER_MINUTE = 60;
const INTERACTIVE_SELECTOR =
  "a,button,input,select,textarea,summary,[role='button'],[role='link'],[data-openrum-name]";
const allowedTags = new Set(["a", "button", "input", "select", "textarea", "summary"]);
const allowedRoles = new Set(["button", "link", "menuitem", "tab"]);
const allowedInputTypes = new Set(["button", "checkbox", "radio", "reset", "submit", "file"]);

export interface BehaviorElement {
  tagName?: string;
  closest?(selector: string): BehaviorElement | null;
  getAttribute?(name: string): string | null;
}

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
  return result;
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
