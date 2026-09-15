import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from "web-vitals";
import type { NavigationType } from "@openrum/protocol";
import type { Integration } from "../client.ts";

type CoreMetric = Pick<Metric, "name" | "value" | "delta" | "rating" | "navigationType">;
type Reporter = (callback: (metric: CoreMetric) => void, options?: WebVitalOptions) => void;

interface WebVitalOptions {
  reportAllChanges?: boolean;
  reportSoftNavs?: boolean;
}

export interface WebVitalsRuntime {
  onCLS: Reporter;
  onINP: Reporter;
  onLCP: Reporter;
  onFCP?: Reporter;
  onTTFB?: Reporter;
}

interface RuntimeHub {
  subscribers: Set<(metric: CoreMetric) => void>;
}

const defaultRuntime: WebVitalsRuntime = { onCLS, onINP, onLCP, onFCP, onTTFB };
const runtimeHubs = new WeakMap<WebVitalsRuntime, RuntimeHub>();

export function webVitalsIntegration(runtime: WebVitalsRuntime = defaultRuntime): Integration {
  return {
    name: "web-vitals",
    setup(client) {
      const hub = getRuntimeHub(runtime);
      const subscriber = (metric: CoreMetric) => {
        try {
          if (
            metric.name !== "LCP" &&
            metric.name !== "INP" &&
            metric.name !== "CLS" &&
            metric.name !== "FCP" &&
            metric.name !== "TTFB"
          )
            return;
          if (!Number.isFinite(metric.value) || metric.value < 0) return;
          client.capture({
            type: "web_vital",
            metric: {
              name: metric.name,
              value: metric.value,
              ...(Number.isFinite(metric.delta) ? { delta: metric.delta } : {}),
              rating: metric.rating,
              navigation_type: normalizeNavigationType(metric.navigationType),
            },
          });
        } catch {
          // Performance callbacks must never affect the monitored page.
        }
      };
      hub.subscribers.add(subscriber);
      return () => hub.subscribers.delete(subscriber);
    },
  };
}

function getRuntimeHub(runtime: WebVitalsRuntime): RuntimeHub {
  const existing = runtimeHubs.get(runtime);
  if (existing) return existing;
  const hub: RuntimeHub = { subscribers: new Set() };
  runtimeHubs.set(runtime, hub);
  const publish = (metric: CoreMetric) => {
    for (const subscriber of hub.subscribers) subscriber(metric);
  };
  const options: WebVitalOptions = { reportAllChanges: false, reportSoftNavs: true };
  for (const register of [
    runtime.onCLS,
    runtime.onINP,
    runtime.onLCP,
    runtime.onFCP,
    runtime.onTTFB,
  ]) {
    if (!register) continue;
    try {
      register(publish, options);
    } catch {
      // Unsupported or partially polyfilled PerformanceObserver implementations are ignored.
    }
  }
  return hub;
}

function normalizeNavigationType(value: Metric["navigationType"]): NavigationType {
  switch (value) {
    case "reload":
    case "prerender":
      return value;
    case "back-forward":
    case "back-forward-cache":
    case "restore":
      return "back_forward";
    case "soft-navigation":
      return "route_change";
    default:
      return "navigate";
  }
}
