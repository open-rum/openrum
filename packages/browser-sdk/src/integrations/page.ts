import type { NavigationType } from "@openrum/protocol";
import type { Integration, OpenRUMClient } from "../client.ts";

interface HistoryLike {
  pushState(data: unknown, unused: string, url?: string | URL | null): unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): unknown;
}

export interface PageRuntime {
  history: HistoryLike;
  location: { href: string };
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  performance?: { getEntriesByType(type: string): ArrayLike<{ type?: string }> };
}

export function pageIntegration(runtime: PageRuntime | undefined = browserRuntime()): Integration {
  return {
    name: "page-views",
    setup(client) {
      if (!runtime) return;
      const pageRuntime = runtime;
      const initialNavigation = readNavigationType(pageRuntime);
      capturePage(client, initialNavigation, false);

      const originalPushState = pageRuntime.history.pushState;
      const originalReplaceState = pageRuntime.history.replaceState;
      const onRouteChange = () => capturePage(client, "route_change", true);
      const onPageShow: EventListener = (event) => {
        if ((event as PageTransitionEvent).persisted) capturePage(client, "back_forward", true);
      };

      function pushState(this: HistoryLike, ...args: Parameters<HistoryLike["pushState"]>) {
        const before = pageRuntime.location.href;
        const result = originalPushState.apply(this, args);
        if (pageRuntime.location.href !== before) onRouteChange();
        return result;
      }

      function replaceState(this: HistoryLike, ...args: Parameters<HistoryLike["replaceState"]>) {
        const before = pageRuntime.location.href;
        const result = originalReplaceState.apply(this, args);
        if (pageRuntime.location.href !== before) onRouteChange();
        return result;
      }

      pageRuntime.history.pushState = pushState;
      pageRuntime.history.replaceState = replaceState;
      pageRuntime.addEventListener("popstate", onRouteChange);
      pageRuntime.addEventListener("pageshow", onPageShow);

      return () => {
        if (pageRuntime.history.pushState === pushState) {
          pageRuntime.history.pushState = originalPushState;
        }
        if (pageRuntime.history.replaceState === replaceState) {
          pageRuntime.history.replaceState = originalReplaceState;
        }
        pageRuntime.removeEventListener("popstate", onRouteChange);
        pageRuntime.removeEventListener("pageshow", onPageShow);
      };
    },
  };
}

function capturePage(
  client: OpenRUMClient,
  navigationType: NavigationType,
  renewPage: boolean,
): void {
  try {
    if (renewPage) client.startPage();
    client.capture({ type: "page_view", navigation_type: navigationType });
  } catch {
    // Public client methods are already guarded; this protects custom client-like wrappers.
  }
}

function readNavigationType(runtime: PageRuntime): NavigationType {
  try {
    const type = runtime.performance?.getEntriesByType("navigation")[0]?.type;
    if (type === "reload" || type === "back_forward" || type === "prerender") return type;
  } catch {
    // Some privacy modes block access to performance entries.
  }
  return "navigate";
}

function browserRuntime(): PageRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  return window as unknown as PageRuntime;
}
