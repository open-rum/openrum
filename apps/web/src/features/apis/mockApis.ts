import type {
  APIFilters,
  APISample,
  APISamples,
  APIsResponse,
  APISummary,
  APITrendPoint,
} from "@/lib/api/apis";
import { minimumAPISamples } from "@/lib/api/apis";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";

// Preview data for the API page (development builds only, user decision 2026-11-11). It is
// built in the browser from the current filters, never sent or stored, and the same filters
// always give the same numbers, so switching views does not reshuffle the page.

type MockEndpoint = {
  method: string;
  url: string;
  /** Requests per hour at the day's peak. */
  volume: number;
  /** Median latency in ms. */
  latency: number;
  /** Share of 5xx and network failures. */
  failure: number;
  routes: string[];
};

const ENDPOINTS: MockEndpoint[] = [
  {
    method: "GET",
    url: "/api/products",
    volume: 1800,
    latency: 120,
    failure: 0.002,
    routes: ["/", "/category/:slug"],
  },
  {
    method: "GET",
    url: "/api/products/:id",
    volume: 1500,
    latency: 95,
    failure: 0.004,
    routes: ["/product/:id"],
  },
  {
    method: "GET",
    url: "/api/cart",
    volume: 900,
    latency: 70,
    failure: 0.001,
    routes: ["/cart", "/product/:id"],
  },
  {
    method: "POST",
    url: "/api/cart/items",
    volume: 420,
    latency: 160,
    failure: 0.012,
    routes: ["/product/:id"],
  },
  {
    method: "GET",
    url: "/api/search",
    volume: 760,
    latency: 340,
    failure: 0.006,
    routes: ["/search"],
  },
  {
    method: "POST",
    url: "/api/checkout",
    volume: 160,
    latency: 820,
    failure: 0.038,
    routes: ["/checkout"],
  },
  {
    method: "POST",
    url: "/api/payments/intent",
    volume: 140,
    latency: 1250,
    failure: 0.071,
    routes: ["/checkout"],
  },
  {
    method: "GET",
    url: "/api/recommendations",
    volume: 640,
    latency: 480,
    failure: 0.009,
    routes: ["/", "/product/:id"],
  },
  {
    method: "POST",
    url: "/api/auth/session",
    volume: 220,
    latency: 210,
    failure: 0.015,
    routes: ["/login"],
  },
  {
    method: "GET",
    url: "/api/orders",
    volume: 120,
    latency: 260,
    failure: 0.003,
    routes: ["/account/orders"],
  },
  {
    method: "PATCH",
    url: "/api/profile",
    volume: 30,
    latency: 180,
    failure: 0.02,
    routes: ["/account"],
  },
  {
    method: "DELETE",
    url: "/api/cart/items/:id",
    volume: 50,
    latency: 110,
    failure: 0.004,
    routes: ["/cart"],
  },
];

const INTERVALS = [
  [60, "1 MINUTE"],
  [300, "5 MINUTE"],
  [900, "15 MINUTE"],
  [1800, "30 MINUTE"],
  [3600, "1 HOUR"],
  [10800, "3 HOUR"],
  [21600, "6 HOUR"],
  [43200, "12 HOUR"],
  [86400, "1 DAY"],
] as const;

const BROWSERS = ["Chrome", "Safari", "Edge", "Firefox"];
const SYSTEMS = ["Windows", "macOS", "iOS", "Android"];
const DEVICES = ["desktop", "mobile", "tablet"];
const COUNTRIES = ["CN", "US", "JP", "DE", "SG"];
const RELEASES = ["web@2.4.0", "web@2.3.2", "web@2.3.1"];
const LATENCY_EDGES = [0, 50, 100, 200, 500, 1000, 2000, 5000];

/** A small seeded generator, so a seed always gives the same sequence. */
function random(seed: string) {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function interval(from: Date, to: Date) {
  const span = (to.getTime() - from.getTime()) / 1000;
  return (
    INTERVALS.find(([seconds]) => span / seconds <= TIME_SERIES_MAX_POINTS) ??
    INTERVALS[INTERVALS.length - 1]
  );
}

/** Daytime traffic is higher than night traffic, like a real storefront. */
function dayCurve(time: number) {
  const hour = new Date(time).getHours() + new Date(time).getMinutes() / 60;
  return 0.35 + 0.65 * Math.max(0, Math.sin(((hour - 6) / 24) * 2 * Math.PI)) ** 1.4;
}

type Bucket = APITrendPoint & { durations: number[] };

function endpointTrend(endpoint: MockEndpoint, from: Date, to: Date, seed: string): Bucket[] {
  const [seconds] = interval(from, to);
  const step = seconds * 1000;
  const next = random(`${seed}:${endpoint.method}:${endpoint.url}`);
  const buckets: Bucket[] = [];
  for (let start = Math.floor(from.getTime() / step) * step; start < to.getTime(); start += step) {
    const requests = Math.round(
      endpoint.volume * (seconds / 3600) * dayCurve(start) * (0.8 + next() * 0.4),
    );
    // An occasional incident makes the failure chart worth reading.
    const incident = next() < 0.06 ? 4 + next() * 6 : 1;
    const failureRate = Math.min(0.6, endpoint.failure * incident);
    const serverErrors = Math.round(requests * failureRate * 0.7);
    const networkErrors = Math.round(requests * failureRate * 0.3);
    const clientErrors = Math.round(requests * 0.01 * next());
    const slow = incident > 1 ? 1.8 : 1;
    const durations = [0.5, 0.75, 0.95].map((quantile) =>
      percentile(endpoint.latency * slow, quantile, next),
    );
    buckets.push({
      bucket: new Date(start).toISOString(),
      requests,
      failures: serverErrors + networkErrors,
      clientErrors,
      serverErrors,
      networkErrors,
      p50: requests ? durations[0]! : null,
      p75: requests ? durations[1]! : null,
      p95: requests ? durations[2]! : null,
      durations,
    });
  }
  return buckets;
}

/** A log-normal-shaped latency quantile around the median. */
function percentile(median: number, quantile: number, next: () => number) {
  const spread = quantile === 0.5 ? 1 : quantile === 0.75 ? 1.6 : 3.2;
  return Math.round(median * spread * (0.9 + next() * 0.2));
}

function sum<T>(items: T[], read: (item: T) => number) {
  return items.reduce((total, item) => total + read(item), 0);
}

function weighted(buckets: Bucket[], key: "p50" | "p75" | "p95") {
  const total = sum(buckets, (bucket) => bucket.requests);
  if (!total) return null;
  return Math.round(sum(buckets, (bucket) => (bucket[key] ?? 0) * bucket.requests) / total);
}

function summarize(trends: Bucket[][]): APISummary {
  const all = trends.flat();
  const requests = sum(all, (bucket) => bucket.requests);
  return {
    requests,
    estimated: requests,
    failures: sum(all, (bucket) => bucket.failures),
    clientErrors: sum(all, (bucket) => bucket.clientErrors),
    serverErrors: sum(all, (bucket) => bucket.serverErrors),
    networkErrors: sum(all, (bucket) => bucket.networkErrors),
    p50: weighted(all, "p50"),
    p75: weighted(all, "p75"),
    p95: weighted(all, "p95"),
    endpoints: trends.filter((trend) => sum(trend, (bucket) => bucket.requests) > 0).length,
  };
}

function mergeTrends(trends: Bucket[][]): APITrendPoint[] {
  const first = trends[0] ?? [];
  return first.map((point, index) => {
    const column = trends.map((trend) => trend[index]!).filter(Boolean);
    return {
      bucket: point.bucket,
      requests: sum(column, (bucket) => bucket.requests),
      failures: sum(column, (bucket) => bucket.failures),
      clientErrors: sum(column, (bucket) => bucket.clientErrors),
      serverErrors: sum(column, (bucket) => bucket.serverErrors),
      networkErrors: sum(column, (bucket) => bucket.networkErrors),
      p50: weighted(column, "p50"),
      p75: weighted(column, "p75"),
      p95: weighted(column, "p95"),
    };
  });
}

function stripDurations(trend: Bucket[]): APITrendPoint[] {
  return trend.map(({ durations: _durations, ...point }) => point);
}

function matchesQuery(endpoint: MockEndpoint, filters: APIFilters) {
  if (filters.route && !endpoint.routes.includes(filters.route)) return false;
  if (filters.methods.length && !filters.methods.includes(endpoint.method)) return false;
  // Free text in the shared search narrows by endpoint; structured terms are ignored here.
  const words = (filters.q ?? "")
    .split(/\s+/)
    .filter((word) => word && !word.includes(":"))
    .map((word) => word.replace(/[*"]/g, "").toLowerCase());
  return words.every((word) => endpoint.url.toLowerCase().includes(word));
}

function share(total: number, values: string[], next: () => number) {
  const weights = values.map((_, index) => (values.length - index) * (0.6 + next() * 0.8));
  const weightTotal = sum(weights, (weight) => weight);
  return values.map((value, index) => ({
    value,
    requests: Math.round((total * weights[index]!) / weightTotal),
  }));
}

/** The API page's response, built from the filters instead of fetched. */
export function mockAPIs(filters: APIFilters): APIsResponse {
  const seed = `${filters.projectId}:${filters.environment ?? ""}:${filters.release ?? ""}`;
  const [, intervalName] = interval(filters.from, filters.to);
  const span = filters.to.getTime() - filters.from.getTime();
  const previousFrom = new Date(filters.from.getTime() - span);
  const visible = ENDPOINTS.filter((endpoint) => matchesQuery(endpoint, filters));
  const trends = visible.map((endpoint) => endpointTrend(endpoint, filters.from, filters.to, seed));
  const previous = visible.map((endpoint) =>
    endpointTrend(endpoint, previousFrom, filters.from, `${seed}:previous`),
  );
  const endpoints = visible
    .map((endpoint, index) => {
      const trend = trends[index]!;
      const totals = summarize([trend]);
      return {
        method: endpoint.method,
        url: endpoint.url,
        requests: totals.requests,
        estimated: totals.estimated,
        failures: totals.failures,
        clientErrors: totals.clientErrors,
        serverErrors: totals.serverErrors,
        networkErrors: totals.networkErrors,
        p50: totals.p50,
        p75: totals.p75,
        p95: totals.p95,
        sufficient: totals.requests >= minimumAPISamples,
      };
    })
    .sort((left, right) => sortValue(right, filters.sort) - sortValue(left, filters.sort));
  const facetsNext = random(`${seed}:facets`);
  const allRequests = sum(endpoints, (endpoint) => endpoint.requests);
  const routes = [...new Set(ENDPOINTS.flatMap((endpoint) => endpoint.routes))];
  const selectedIndex = visible.findIndex(
    (endpoint) => endpoint.method === filters.method && endpoint.url === filters.url,
  );
  return {
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    interval: intervalName,
    summary: summarize(trends),
    previous: summarize(previous),
    trend: mergeTrends(trends),
    facets: {
      methods: [...new Set(ENDPOINTS.map((endpoint) => endpoint.method))].map((method) => ({
        value: method,
        requests: sum(
          endpoints.filter((endpoint) => endpoint.method === method),
          (endpoint) => endpoint.requests,
        ),
      })),
      releases: share(allRequests, RELEASES, facetsNext),
      routes: share(allRequests, routes, facetsNext),
    },
    endpoints,
    truncated: false,
    detail:
      selectedIndex >= 0
        ? mockDetail(visible[selectedIndex]!, trends[selectedIndex]!, endpoints, seed)
        : undefined,
  };
}

function sortValue(endpoint: APIsResponse["endpoints"][number], sort: APIFilters["sort"]) {
  switch (sort) {
    case "failures":
      return endpoint.failures;
    case "failureRate":
      return endpoint.requests ? endpoint.failures / endpoint.requests : 0;
    case "p95":
      return endpoint.p95 ?? 0;
    case "impact":
      return endpoint.requests * (endpoint.p95 ?? 0);
    default:
      return endpoint.requests;
  }
}

function mockDetail(
  endpoint: MockEndpoint,
  trend: Bucket[],
  endpoints: APIsResponse["endpoints"],
  seed: string,
): NonNullable<APIsResponse["detail"]> {
  const row = endpoints.find(
    (item) => item.method === endpoint.method && item.url === endpoint.url,
  )!;
  const next = random(`${seed}:${endpoint.method}:${endpoint.url}:detail`);
  const dimension = (values: string[]) =>
    share(row.requests, values, next).map((item) => ({
      ...item,
      failures: Math.round(
        item.requests * (row.failures / Math.max(1, row.requests)) * (0.5 + next()),
      ),
      p95: row.p95 === null ? null : Math.round(row.p95 * (0.8 + next() * 0.4)),
    }));
  const success = row.requests - row.failures - row.clientErrors;
  const latency = LATENCY_EDGES.map((fromMs, index) => {
    const toMs = LATENCY_EDGES[index + 1] ?? null;
    const middle = toMs === null ? fromMs * 1.5 : (fromMs + toMs) / 2;
    const distance = Math.abs(Math.log(middle / Math.max(1, endpoint.latency)));
    return { fromMs, toMs, weight: Math.exp(-distance * 1.4) };
  });
  const latencyTotal = sum(latency, (bucket) => bucket.weight);
  return {
    endpoint: row,
    trend: stripDurations(trend),
    routes: share(row.requests, endpoint.routes, next).map((item) => ({
      route: item.value,
      requests: item.requests,
      failures: Math.round(item.requests * (row.failures / Math.max(1, row.requests))),
    })),
    statuses: [
      { status: endpoint.method === "POST" ? 201 : 200, requests: Math.max(0, success) },
      { status: 404, requests: Math.round(row.clientErrors * 0.6) },
      { status: 401, requests: Math.round(row.clientErrors * 0.4) },
      { status: 500, requests: Math.round(row.serverErrors * 0.7) },
      { status: 503, requests: Math.round(row.serverErrors * 0.3) },
      { status: 0, failure: "network", requests: row.networkErrors },
    ].filter((status) => status.requests > 0),
    latency: latency.map(({ fromMs, toMs, weight }) => ({
      fromMs,
      toMs,
      requests: Math.round((row.requests * weight) / latencyTotal),
    })),
    payload: {
      samples: row.requests,
      p50: endpoint.method === "GET" ? 3200 : 640,
      p95: endpoint.method === "GET" ? 18400 : 2100,
    },
    dimensions: {
      browsers: dimension(BROWSERS),
      operatingSystems: dimension(SYSTEMS),
      devices: dimension(DEVICES),
      countries: dimension(COUNTRIES),
      releases: dimension(RELEASES),
    },
  };
}

/** The newest requests of the selected endpoint, optionally only one user's. */
export function mockAPISamples(filters: APIFilters, user: string): APISamples {
  const endpoint = ENDPOINTS.find(
    (item) => item.method === filters.method && item.url === filters.url,
  );
  if (!endpoint) return { samples: [], truncated: false };
  const next = random(`${filters.projectId}:${endpoint.method}:${endpoint.url}:samples`);
  const samples: APISample[] = [];
  const span = filters.to.getTime() - filters.from.getTime();
  for (let index = 0; index < 40; index += 1) {
    const roll = next();
    // A failed request is a 5xx, or a network failure or timeout with no status.
    const failed = roll < endpoint.failure * 3;
    const failure = failed && next() < 0.3 ? (next() < 0.7 ? "network" : "timeout") : undefined;
    const status = failure ? 0 : failed ? 500 : roll > 0.97 ? 404 : 200;
    const userNumber = 1 + Math.floor(next() * 12);
    const route = endpoint.routes[Math.floor(next() * endpoint.routes.length)]!;
    const path = endpoint.url.replace(/:id/g, String(1000 + Math.floor(next() * 9000)));
    const sample: APISample = {
      eventId: `mock-${endpoint.method}-${index}`,
      timestamp: new Date(
        filters.to.getTime() - (span * index) / 40 - next() * 60000,
      ).toISOString(),
      method: endpoint.method,
      url: `https://shop.example.com${path}`,
      status,
      failure,
      durationMs: Math.round(endpoint.latency * (0.4 + next() * 2.4) * (failed ? 3 : 1)),
      transferSize: Math.round(400 + next() * 12000),
      route,
      pageUrl: `https://shop.example.com${route.replace(/:\w+/g, "demo")}`,
      environment: filters.environment ?? "production",
      release: RELEASES[Math.floor(next() * RELEASES.length)],
      browser: BROWSERS[Math.floor(next() * BROWSERS.length)],
      browserVersion: "130.0",
      os: SYSTEMS[Math.floor(next() * SYSTEMS.length)],
      deviceType: DEVICES[Math.floor(next() * DEVICES.length)],
      country: COUNTRIES[Math.floor(next() * COUNTRIES.length)],
      sessionId: `mock-session-${userNumber}`,
      anonymousUserId: `anon-${String(userNumber).padStart(4, "0")}`,
      userId: userNumber % 3 === 0 ? `user-${userNumber}` : undefined,
      traceId: `mock${index.toString(16).padStart(28, "0")}`,
    };
    samples.push(sample);
  }
  const filtered = user
    ? samples.filter(
        (sample) => sample.anonymousUserId?.startsWith(user) || sample.userId?.startsWith(user),
      )
    : samples;
  return { samples: filtered, truncated: false };
}
