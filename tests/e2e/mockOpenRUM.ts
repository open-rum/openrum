import type { Page, Route } from "@playwright/test";

export const projectId = "018f4d9c-83a1-76c9-81c2-3020ab667090";
export const secondProjectId = "018f4d9c-83a1-76c9-81c2-3020ab667099";
const organizationId = "018f4d9c-83a1-76c9-81c2-3020ab667091";
const now = "2026-09-03T00:00:00.000Z";

export async function mockOpenRUM(
  page: Page,
  options: {
    projectExists?: boolean;
    projectCount?: number;
    failIssuePatch?: boolean;
    failProjectPatch?: boolean;
    role?: "owner" | "admin" | "member" | "viewer";
    performanceState?: "populated" | "empty" | "error";
    instanceRole?: "instance_owner" | "instance_admin";
  } = {},
) {
  let projectCreated = options.projectExists ?? false;
  let queryable = options.projectExists ?? false;
  let releaseCreated = true;
  let artifactReady = false;
  const projectSettings: MutableProject = { ...defaultProjectSettings };
  let inboundFilters: InboundFilters = {
    builtin: { ...defaultInboundFilters.builtin },
    rules: [],
  };
  const alertRules: Array<Record<string, unknown>> = [];
  const channels: Array<Record<string, unknown>> = [];
  const role = options.role ?? "owner";
  const ingestRequests: string[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/ingest/")) ingestRequests.push(request.url());
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/v1/setup/status") return json(route, { initialized: true });
    if (path === "/api/v1/auth/me")
      return json(route, {
        userId: "018f4d9c-83a1-76c9-81c2-3020ab667092",
        email: "e2e@openrum.local",
        displayName: "E2E Owner",
        ...(options.instanceRole ? { instanceRole: options.instanceRole } : {}),
      });
    if (path === "/api/v1/auth/reauthenticate")
      return json(route, { elevated: true, expiresInSeconds: 300 });
    if (path === "/api/v1/admin/configuration" && request.method() === "PATCH") {
      const body = request.postDataJSON() as {
        namespace: string;
        key: string;
        value: number;
        expectedVersion: number;
      };
      return json(route, {
        namespace: body.namespace,
        key: body.key,
        effectiveValue: body.value,
        source: "instance",
        locked: false,
        version: body.expectedVersion + 1,
        updatedAt: now,
      });
    }
    if (path === "/api/v1/admin/configuration")
      return json(route, {
        settings: [
          {
            namespace: "retention",
            key: "rawDays",
            effectiveValue: 14,
            source: "default",
            locked: false,
            version: 0,
            updatedAt: null,
          },
          {
            namespace: "retention",
            key: "aggregateDays",
            effectiveValue: 90,
            source: "instance",
            locked: false,
            version: 2,
            updatedAt: now,
          },
          {
            namespace: "retention",
            key: "sourceMapDays",
            effectiveValue: 0,
            source: "deployment",
            locked: true,
            version: 0,
            updatedAt: null,
          },
        ],
      });
    if (path === "/api/v1/admin/maintenance-jobs") return json(route, { jobs: [] });
    if (path === "/api/v1/admin/audit-logs")
      return json(route, {
        entries: [
          {
            id: 1,
            actorEmail: "e2e@openrum.local",
            requestId: "req-e2e",
            action: "PATCH /api/v1/admin/configuration",
            resourceType: "configuration",
            resourcePath: "/api/v1/admin/configuration",
            configSource: "request",
            changeSummary: { method: "PATCH" },
            createdAt: now,
          },
        ],
      });
    if (path === "/api/v1/admin/object-storage")
      return json(route, {
        provider: "none",
        providerLabel: "未启用",
        configured: false,
        region: "",
        bucket: "",
        endpoint: "—",
        diagnosticPrefix: "openrum-diagnostics/connectivity/",
        credentialSource: "none",
        maskedIdentity: "",
        managedBy: "未配置",
        testAvailable: false,
        managedSecretsAvailable: false,
        configurationSource: "deployment",
      });
    if (path === "/api/v1/organizations")
      return json(route, {
        organizations: [
          {
            id: organizationId,
            name: "E2E Organization",
            slug: "e2e-organization",
            role,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    if (path === `/api/v1/organizations/${organizationId}/projects`) {
      if (request.method() === "POST") {
        projectCreated = true;
        return json(route, project(true, role, projectSettings), 201);
      }
      return json(route, {
        projects: projectCreated
          ? [
              project(false, role, projectSettings),
              ...(options.projectCount === 2
                ? [
                    {
                      ...project(false, role, projectSettings),
                      id: secondProjectId,
                      name: "Admin Console",
                      slug: "admin-console",
                      environment: "staging",
                    },
                  ]
                : []),
            ]
          : [],
      });
    }
    if (path === `/api/v1/projects/${projectId}`) {
      if (request.method() === "PATCH") {
        if (options.failProjectPatch)
          return json(route, { error: { code: "QUERY_UNAVAILABLE", requestId: "e2e" } }, 503);
        Object.assign(projectSettings, request.postDataJSON() as Partial<MutableProject>);
      }
      return json(route, project(false, role, projectSettings));
    }
    if (path === `/api/v1/projects/${projectId}/filters`) {
      if (request.method() === "PUT") {
        const payload = request.postDataJSON() as typeof inboundFilters;
        // Replaced wholesale, the way the server replaces the document.
        inboundFilters = {
          builtin: { ...defaultInboundFilters.builtin, ...payload.builtin },
          rules: payload.rules ?? [],
        };
      }
      return json(route, inboundFilters);
    }
    if (path === `/api/v1/projects/${projectId}/connection-status`)
      return json(route, {
        keyConfigured: true,
        lastSdkSeenAt: queryable ? now : null,
        lastEventReceivedAt: queryable ? now : null,
        lastEventQueryableAt: queryable ? now : null,
        lastRejectReason: null,
        lastRejectAt: null,
      });
    if (path === `/api/v1/projects/${secondProjectId}/connection-status`)
      return json(route, {
        keyConfigured: true,
        lastSdkSeenAt: now,
        lastEventReceivedAt: now,
        lastEventQueryableAt: now,
        lastRejectReason: null,
        lastRejectAt: null,
      });
    if (path === `/api/v1/projects/${projectId}/test-event`) {
      queryable = true;
      return json(
        route,
        { eventId: "018f4d9c-83a1-76c9-81c2-3020ab667093", status: "accepted", acceptedAt: now },
        202,
      );
    }
    if (path === `/api/v1/projects/${projectId}/overview`) return json(route, overview());
    if (path === `/api/v1/projects/${projectId}/analytics/funnels/query`)
      return json(route, {
        from: "2026-09-02T00:00:00.000Z",
        to: now,
        dimension: "country",
        windowSeconds: 3600,
        identity: "session_id",
        approximate: true,
        steps: [
          {
            index: 1,
            kind: "page_view",
            name: "page_view",
            sessions: 24,
            conversionFromPrevious: null,
            conversionFromFirst: null,
          },
          {
            index: 2,
            kind: "click",
            name: "click",
            sessions: 15,
            conversionFromPrevious: 0.625,
            conversionFromFirst: 0.625,
          },
        ],
        breakdown: [{ value: "CN", stepCounts: [18, 12] }],
        samples: [
          { sessionId: "018f4d9c-83a1-76c9-81c2-3020ab667094", reachedStep: 2, lastSeenAt: now },
        ],
      });
    if (path === `/api/v1/projects/${projectId}/analytics/events/samples`)
      return json(route, behaviorSamples());
    if (path === `/api/v1/projects/${projectId}/analytics/events`)
      return json(route, behaviorAnalytics());
    if (path === `/api/v1/projects/${secondProjectId}/analytics/events`)
      return json(route, behaviorAnalytics());
    if (path === `/api/v1/projects/${projectId}/analytics/sessions`) return json(route, sessions());
    if (path.startsWith(`/api/v1/projects/${projectId}/analytics/sessions/`))
      return json(route, sessionTimeline(url.searchParams));
    if (path === `/api/v1/projects/${projectId}/performance`) {
      if (options.performanceState === "error")
        return json(route, { error: { code: "QUERY_UNAVAILABLE", requestId: "e2e" } }, 503);
      if (options.performanceState === "empty")
        return json(route, {
          from: "2026-09-02T00:00:00.000Z",
          to: now,
          routes: [],
          trend: [],
        });
      return json(
        route,
        performance(url.searchParams.get("route"), url.searchParams.get("metric")),
      );
    }
    if (path === `/api/v1/projects/${projectId}/apis`)
      return json(
        route,
        apiMonitoring(url.searchParams.get("method"), url.searchParams.get("url")),
      );
    if (path === `/api/v1/projects/${projectId}/usage`) return json(route, usage());
    if (path === `/api/v1/projects/${projectId}/usage.csv`)
      return route.fulfill({
        status: 200,
        contentType: "text/csv",
        body: "bucket,event_type,outcome,reason,events,estimated,bytes\n",
      });
    if (path === `/api/v1/projects/${projectId}/alerts`) {
      if (request.method() === "POST") {
        const payload = request.postDataJSON() as Record<string, unknown>;
        const rule = { id: `rule-${alertRules.length + 1}`, projectId, ...payload };
        alertRules.push(rule);
        return json(route, rule, 201);
      }
      return json(route, {
        rules: alertRules,
        notifications: alertRules.length
          ? [
              {
                id: "notification-1",
                ruleId: alertRules[0].id,
                title: alertRules[0].name,
                value: 3.4,
                threshold: alertRules[0].threshold,
                occurredAt: now,
                deepLink: `/issues?project=${projectId}&environment=production&from=2026-09-02T23%3A55%3A00.000Z&to=2026-09-03T00%3A00%3A00.000Z`,
                status: "sent",
              },
            ]
          : [],
      });
    }
    if (path === `/api/v1/organizations/${organizationId}/channels`) {
      if (request.method() === "POST") {
        const payload = request.postDataJSON() as Record<string, unknown>;
        const channel = {
          id: `channel-${channels.length + 1}`,
          organizationId,
          name: payload.name,
          kind: payload.kind,
          enabled: true,
          createdAt: now,
        };
        channels.push(channel);
        return json(route, channel, 201);
      }
      return json(route, { channels });
    }
    if (path === `/api/v1/projects/${projectId}/issues`) return json(route, issues());
    if (path === `/api/v1/organizations/${organizationId}/members`)
      return json(route, {
        members: [
          {
            userId: "018f4d9c-83a1-76c9-81c2-3020ab667092",
            email: "e2e@openrum.local",
            displayName: "E2E Owner",
            role: "owner",
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    if (path.startsWith(`/api/v1/projects/${projectId}/issues/`)) {
      const suffix = decodeURIComponent(path.slice(`/api/v1/projects/${projectId}/issues/`.length));
      const fingerprint = suffix.replace(/\/events$/, "");
      if (suffix.endsWith("/events")) return json(route, { events: [eventDetail(fingerprint)] });
      if (request.method() === "PATCH") {
        const payload = request.postDataJSON() as { status?: string; assigneeUserId?: string };
        if (options.failIssuePatch) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return json(
            route,
            { error: { code: "FORBIDDEN", message: "denied", requestId: "e2e" } },
            403,
          );
        }
        return json(route, {
          projectId,
          fingerprint,
          fingerprintVersion: 1,
          status: payload.status ?? "unresolved",
          ...(payload.assigneeUserId ? { assigneeUserId: payload.assigneeUserId } : {}),
          createdAt: now,
          updatedAt: now,
        });
      }
      const issue =
        issues().issues.find((item) => item.fingerprint === fingerprint) ?? issues().issues[0];
      return json(route, {
        issue,
        trend: [
          { bucket: "2026-09-02T22:00:00.000Z", events: 14, users: 9, sessions: 10 },
          { bucket: "2026-09-02T23:00:00.000Z", events: 28, users: 16, sessions: 18 },
          { bucket: now, events: 42, users: 21, sessions: 24 },
        ],
        facets: issues().facets,
      });
    }
    if (path.startsWith("/api/v1/events/")) return json(route, eventDetail("v1:e2e-0", true));
    if (path === `/api/v1/projects/${projectId}/releases`) {
      if (request.method() === "POST") releaseCreated = true;
      return json(
        route,
        request.method() === "POST" ? release() : { releases: releaseCreated ? [release()] : [] },
        request.method() === "POST" ? 201 : 200,
      );
    }
    if (path === `/api/v1/projects/${projectId}/releases/release-e2e/artifacts`) {
      return json(route, { artifacts: artifactReady ? [artifact()] : [] });
    }
    if (path === `/api/v1/projects/${projectId}/releases/release-e2e/artifacts/presign`) {
      return json(
        route,
        {
          artifact: { ...artifact(), status: "pending" },
          uploadUrl: "https://oss.example/openrum-upload",
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          expiresAt: "2026-09-03T00:15:00.000Z",
        },
        201,
      );
    }
    if (
      path === `/api/v1/projects/${projectId}/releases/release-e2e/artifacts/artifact-e2e/complete`
    ) {
      artifactReady = true;
      return json(route, artifact());
    }
    if (path === `/api/v1/projects/${projectId}/sourcemaps/test`)
      return json(route, {
        raw: "at OpenRUMTest (https://example.com/assets/app.js:1:482)",
        status: "mapped",
        frames: [
          {
            function: "OpenRUMTest",
            url: "https://example.com/assets/app.js",
            line: 1,
            column: 482,
            original: {
              source: "src/checkout/submit.ts",
              function: "submitOrder",
              line: 42,
              column: 11,
            },
          },
        ],
      });
    return json(route, { error: { code: "NOT_FOUND", message: path, requestId: "e2e" } }, 404);
  });

  return { ingestRequests };
}

function apiMonitoring(method: string | null, url: string | null) {
  const endpoints = [
    {
      method: "GET",
      url: "https://api.example/products/:id",
      requests: 18240,
      estimated: 42000,
      failures: 420,
      clientErrors: 180,
      serverErrors: 190,
      networkErrors: 50,
      p50: 124,
      p75: 210,
      p95: 680,
      sufficient: true,
    },
    {
      method: "POST",
      url: "https://api.example/orders",
      requests: 6840,
      estimated: 12000,
      failures: 94,
      clientErrors: 20,
      serverErrors: 62,
      networkErrors: 12,
      p50: 240,
      p75: 410,
      p95: 920,
      sufficient: true,
    },
    {
      method: "DELETE",
      url: "https://api.example/carts/:id/items/:id",
      requests: 18,
      estimated: 90,
      failures: 4,
      clientErrors: 3,
      serverErrors: 1,
      networkErrors: 0,
      p50: 900,
      p75: 1800,
      p95: 4200,
      sufficient: false,
    },
  ];
  const selected = endpoints.find((endpoint) => endpoint.method === method && endpoint.url === url);
  const trend = [
    { bucket: "2026-09-02T22:00:00.000Z", requests: 720, failures: 12, clientErrors: 34, p95: 610 },
    { bucket: "2026-09-02T23:00:00.000Z", requests: 840, failures: 21, clientErrors: 28, p95: 680 },
  ];
  const total = (source: typeof endpoints, key: "requests" | "estimated" | "failures") =>
    source.reduce((sum, item) => sum + item[key], 0);
  return {
    from: "2026-09-02T00:00:00.000Z",
    to: now,
    summary: {
      requests: total(endpoints, "requests"),
      estimated: total(endpoints, "estimated"),
      failures: total(endpoints, "failures"),
      clientErrors: 203,
      serverErrors: 253,
      networkErrors: 62,
      p50: 160,
      p75: 280,
      p95: 740,
      endpoints: endpoints.length,
    },
    previous: {
      requests: 22000,
      estimated: 48000,
      failures: 360,
      clientErrors: 150,
      serverErrors: 170,
      networkErrors: 40,
      p50: 150,
      p75: 260,
      p95: 660,
      endpoints: endpoints.length,
    },
    trend,
    facets: {
      methods: [
        { value: "GET", requests: 18240 },
        { value: "POST", requests: 6840 },
        { value: "DELETE", requests: 18 },
      ],
      releases: [{ value: "web@2026.09.03", requests: 25098 }],
      routes: [{ value: "/products/:id", requests: 12000 }],
    },
    truncated: false,
    endpoints,
    ...(selected
      ? {
          detail: {
            endpoint: selected,
            trend,
            routes: [{ route: "/products/:id", requests: 12000, failures: 310 }],
            statuses: [
              { status: 200, requests: 17820 },
              { status: 503, failure: "http", requests: 190 },
              { status: 404, requests: 180 },
              { status: 0, failure: "network", requests: 50 },
            ],
            latency: [
              { fromMs: 0, toMs: 100, requests: 6200 },
              { fromMs: 100, toMs: 300, requests: 8100 },
              { fromMs: 300, toMs: 500, requests: 2400 },
              { fromMs: 500, toMs: 1000, requests: 1100 },
              { fromMs: 1000, toMs: 3000, requests: 380 },
              { fromMs: 3000, toMs: null, requests: 60 },
            ],
            payload: { samples: 17200, p50: 4820, p95: 61440 },
            dimensions: {
              browsers: [
                { value: "Chrome", requests: 14200, failures: 210, p95: 610 },
                { value: "Safari", requests: 3200, failures: 190, p95: 1480 },
              ],
              operatingSystems: [{ value: "macOS", requests: 9400, failures: 160, p95: 700 }],
              devices: [{ value: "desktop", requests: 15100, failures: 300, p95: 640 }],
              countries: [{ value: "CN", requests: 16800, failures: 380, p95: 690 }],
              releases: [{ value: "web@2026.09.03", requests: 18240, failures: 420, p95: 680 }],
            },
            samples: [
              {
                eventId: "018f4d9c-83a1-76c9-81c2-3020ab667098",
                timestamp: now,
                status: 503,
                failure: "http",
                durationMs: 1830,
                route: "/products/:id",
                pageUrl: "https://shop.example/products/42",
                release: "web@2026.09.03",
                browser: "Chrome",
                sessionId: "018f4d9c-83a1-76c9-81c2-3020ab667099",
                traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
              },
            ],
          },
        }
      : {}),
  };
}

function behaviorAnalytics() {
  const metric = (events: number, users: number, sessions: number) => ({
    events,
    estimated: events,
    uniqueUsers: users,
    uniqueSessions: sessions,
    approximate: true,
  });
  return {
    from: "2026-09-02T00:00:00.000Z",
    to: now,
    dimension: "country",
    interval: "15 MINUTE",
    totals: metric(18420, 4260, 5130),
    trend: [],
    breakdown: [{ value: "CN", metric: metric(14200, 3180, 3890) }],
    catalog: [
      { kind: "page_view", name: "page_view", metric: metric(9200, 4010, 4900) },
      { kind: "click", name: "click", metric: metric(6400, 2870, 3120) },
    ],
    properties: [],
    freshness: { latestReceivedAt: now, ageSeconds: 5, stale: false },
    sampleCount: 18420,
    rowLimit: 100,
  };
}

function behaviorSamples() {
  return {
    limit: 50,
    samples: [
      {
        eventId: "018f4d9c-83a1-76c9-81c2-3020ab667097",
        timestamp: "2026-09-02T23:59:00.000Z",
        kind: "click",
        name: "click",
        route: "/checkout",
        pageUrl: "https://shop.example/checkout",
        browser: "Chrome",
        device: "desktop",
        country: "CN",
        sessionId: "018f4d9c-83a1-76c9-81c2-3020ab667094",
        visitorId: "visitor_7fa2",
        attributes: { role: "button", name: "提交订单" },
        breadcrumbs: [],
      },
    ],
  };
}

function sessionTimeline(parameters: URLSearchParams) {
  return {
    projectId,
    sessionId: "018f4d9c-83a1-76c9-81c2-3020ab667094",
    from: parameters.get("from") ?? "2026-09-02T23:45:00.000Z",
    to: parameters.get("to") ?? "2026-09-03T00:05:00.000Z",
    truncated: false,
    events: [
      {
        eventId: "018f4d9c-83a1-76c9-81c2-3020ab667096",
        timestamp: "2026-09-02T23:58:00.000Z",
        kind: "page_view",
        title: "/checkout",
        route: "/checkout",
        attributes: {},
      },
      {
        eventId: "018f4d9c-83a1-76c9-81c2-3020ab667097",
        timestamp: "2026-09-02T23:59:00.000Z",
        kind: "click",
        title: "元素点击",
        route: "/checkout",
        attributes: { role: "button", name: "提交订单" },
      },
      {
        eventId: "018f4d9c-83a1-76c9-81c2-3020ab667093",
        timestamp: now,
        kind: "error",
        title: "TypeError",
        route: "/checkout",
        fingerprint: "v1:e2e-0",
        errorMessage: "checkout amount is undefined",
        attributes: {},
      },
    ],
  };
}

function sessions() {
  return {
    sessions: [
      {
        sessionId: "018f4d9c-83a1-76c9-81c2-3020ab667094",
        visitorId: "visitor_7fa2",
        startedAt: "2026-09-02T23:57:00.000Z",
        endedAt: now,
        durationSeconds: 180,
        events: 3,
        pageViews: 1,
        errors: 1,
        apiFailures: 1,
        customEvents: 1,
        environment: "production",
        release: "web@2026.09.03",
        browser: "Chrome",
        os: "macOS",
        deviceType: "desktop",
        country: "CN",
        entryRoute: "/checkout",
        exitRoute: "/checkout",
        slowestApiMs: 842,
        lcp: 2180,
        inp: 184,
        cls: 0.082,
      },
    ],
    page: 1,
    limit: 50,
    hasMore: false,
    facets: {
      environments: [{ value: "production", sessions: 1 }],
      releases: [{ value: "web@2026.09.03", sessions: 1 }],
      browsers: [{ value: "Chrome", sessions: 1 }],
      deviceTypes: [{ value: "desktop", sessions: 1 }],
      countries: [{ value: "CN", sessions: 1 }],
    },
  };
}

function performance(route: string | null, selectedMetric: string | null) {
  const metric = (p75: number | null, samples: number) => ({
    p75,
    samples,
    sufficient: samples >= 75,
  });
  const routes = [
    {
      route: "/checkout",
      pageViews: 18240,
      lcp: metric(2180, 920),
      inp: metric(184, 64),
      cls: metric(0.082, 910),
    },
    {
      route: "/products/:id",
      pageViews: 9830,
      lcp: metric(2860, 620),
      inp: metric(242, 48),
      cls: metric(0.12, 618),
    },
  ];
  const trend = [
    ["2026-08-28T00:00:00.000Z", 2460, 224, 0.112],
    ["2026-08-29T00:00:00.000Z", 2380, 211, 0.104],
    ["2026-08-30T00:00:00.000Z", 2510, 219, 0.118],
    ["2026-08-31T00:00:00.000Z", 2290, 197, 0.092],
    ["2026-09-01T00:00:00.000Z", 2190, 188, 0.087],
    ["2026-09-02T00:00:00.000Z", 2250, 193, 0.085],
    ["2026-09-03T00:00:00.000Z", 2180, 184, 0.082],
  ].map(([bucket, lcp, inp, cls], index) => ({
    bucket,
    lcp: metric(lcp as number, 760 + index * 24),
    inp: metric(inp as number, 710 + index * 21),
    cls: metric(cls as number, 750 + index * 22),
  }));
  return {
    from: "2026-09-02T00:00:00.000Z",
    to: now,
    routes,
    trend,
    ...(route
      ? {
          detail: {
            route,
            metric: selectedMetric === "INP" || selectedMetric === "CLS" ? selectedMetric : "LCP",
            trend: [
              { bucket: "2026-09-02T22:00:00.000Z", metric: metric(1900, 80) },
              { bucket: "2026-09-02T23:00:00.000Z", metric: metric(2180, 92) },
            ],
            distribution: [
              { from: 1000, to: 1250, samples: 24 },
              { from: 1250, to: 1500, samples: 48 },
              { from: 1500, to: 1750, samples: 31 },
            ],
            browsers: [
              { value: "Chrome", metric: metric(2040, 680) },
              { value: "Safari", metric: metric(2480, 62) },
            ],
            deviceTypes: [
              { value: "desktop", metric: metric(1960, 510) },
              { value: "mobile", metric: metric(2710, 410) },
            ],
            samples: [
              {
                eventId: "018f4d9c-83a1-76c9-81c2-3020ab667099",
                timestamp: now,
                value: 4210,
                pageUrl: "https://shop.example/checkout",
                browser: "Safari",
                deviceType: "mobile",
                country: "CN",
                release: "web@2026.09.03",
              },
            ],
          },
        }
      : {}),
  };
}

function release() {
  return {
    id: "release-e2e",
    projectId,
    version: "web@2026.09.03",
    dist: "browser",
    commitSha: "a1b2c3d",
    deployedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function artifact() {
  return {
    id: "artifact-e2e",
    releaseId: "release-e2e",
    artifactName: "assets/app.js.map",
    sizeBytes: 1048,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  };
}

function eventDetail(fingerprint: string, includeContext = false) {
  return {
    projectId,
    eventId: "018f4d9c-83a1-76c9-81c2-3020ab667093",
    timestamp: "2026-09-03T00:00:00.000Z",
    receivedAt: "2026-09-03T00:00:01.000Z",
    environment: "production",
    release: "web@2026.09.03",
    dist: "browser",
    sessionId: "018f4d9c-83a1-76c9-81c2-3020ab667094",
    visitorId: "visitor_7fa2",
    pageId: "018f4d9c-83a1-76c9-81c2-3020ab667095",
    pageUrl: "https://shop.example/checkout",
    route: "/checkout",
    browser: "Chrome",
    browserVersion: "128",
    os: "macOS",
    osVersion: "15.0",
    deviceType: "desktop",
    country: "CN",
    errorType: "TypeError",
    errorMessage: "checkout amount is undefined",
    originalStack: "at submit (https://shop.example/assets/checkout.js:1:482)",
    errorMechanism: "onerror",
    fingerprint,
    fingerprintVersion: 1,
    handled: false,
    breadcrumbs: includeContext
      ? [JSON.stringify({ category: "ui.click", message: "点击提交订单", timestamp: now })]
      : [],
    ingestFlags: [],
    availability: { stack: true, breadcrumbs: includeContext, visitor: true, release: true },
    relatedApis: includeContext
      ? [
          {
            eventId: "018f4d9c-83a1-76c9-81c2-3020ab667096",
            timestamp: now,
            method: "POST",
            url: "https://api.example/orders",
            status: 500,
            durationMs: 842,
            route: "/checkout",
          },
        ]
      : [],
    ...(includeContext
      ? {
          mappedStack: {
            raw: "at submit (https://shop.example/assets/checkout.js:1:482)",
            status: "mapped",
            frames: [
              {
                function: "submit",
                url: "https://shop.example/assets/checkout.js",
                line: 1,
                column: 482,
                original: {
                  source: "src/checkout/submit.ts",
                  function: "submitOrder",
                  line: 4,
                  column: 11,
                  sourceContent:
                    "export async function submitOrder() {\n  const cart = getCart();\n  const amount = cart.total;\n  return api.post('/orders', { amount });\n}",
                },
              },
            ],
          },
        }
      : {}),
  };
}

function issues() {
  const statuses = ["unresolved", "resolved", "ignored"] as const;
  return {
    issues: statuses.map((status, index) => ({
      fingerprint: `v1:e2e-${index}`,
      fingerprintVersion: 1,
      title: [
        "TypeError: checkout amount is undefined",
        "NetworkError: payment request failed",
        "ChunkLoadError: loading dashboard chunk",
      ][index],
      errorType: ["TypeError", "NetworkError", "ChunkLoadError"][index],
      events: 1240 - index * 310,
      users: 386 - index * 91,
      sessions: 412 - index * 87,
      firstSeenAt: `2026-09-0${index + 1}T08:00:00.000Z`,
      lastSeenAt: `2026-09-03T0${9 - index}:30:00.000Z`,
      status,
      assigneeUserId: null,
      resolvedInReleaseId: null,
    })),
    nextCursor: "eyJlIjozMDB9",
    facets: {
      environments: [{ value: "production", events: 2470, users: 702 }],
      releases: [{ value: "web@2026.09.03", events: 1900, users: 580 }],
      browsers: [
        { value: "Chrome", events: 2040, users: 640 },
        { value: "Safari", events: 430, users: 62 },
      ],
      deviceTypes: [
        { value: "desktop", events: 1820, users: 530 },
        { value: "mobile", events: 650, users: 172 },
      ],
      countries: [
        { value: "CN", events: 2010, users: 610 },
        { value: "US", events: 460, users: 92 },
      ],
    },
  };
}

// Everything PATCH /api/v1/projects/{id} can change. Held as one object so the
// mock can merge a partial payload the same way the server's COALESCE does.
type MutableProject = {
  name: string;
  slug: string;
  allowedOrigins: string[];
  environment: string;
  retentionDays: number;
  eventSampleRate: number;
  apiSampleRate: number;
  errorSampleRate: number;
  status: "active" | "disabled";
};

type InboundFilters = {
  builtin: Record<string, "off" | "dry_run" | "enforced">;
  rules: Array<{ id: string; kind: string; pattern: string; mode: string; note?: string }>;
};

// Every category is reported, including the off ones, the way the API does.
const defaultInboundFilters: InboundFilters = {
  builtin: { bot: "off", extension: "off", localhost: "off" },
  rules: [],
};

const defaultProjectSettings: MutableProject = {
  name: "Magic Moment H5",
  slug: "magic-moment-h5",
  allowedOrigins: ["http://127.0.0.1:4174"],
  environment: "production",
  retentionDays: 14,
  eventSampleRate: 1,
  apiSampleRate: 0.2,
  errorSampleRate: 1,
  status: "active",
};

function project(
  includeKey: boolean,
  role: "owner" | "admin" | "member" | "viewer" = "owner",
  settings: MutableProject = defaultProjectSettings,
) {
  return {
    id: projectId,
    organizationId,
    ...settings,
    role,
    createdAt: now,
    updatedAt: now,
    ...(includeKey ? { writeKey: "orum_e2e_one_time_write_key" } : {}),
  };
}

function usage() {
  const rows = [
    ["page_view", 12000, 12000, 1800000],
    ["api", 3600, 18000, 720000],
    ["error", 240, 240, 96000],
  ] as const;
  return {
    from: "2026-08-27T00:00:00.000Z",
    to: "2026-09-03T00:00:00.000Z",
    intervalSeconds: 86400,
    totals: {
      accepted: 15840,
      estimated: 30240,
      sampled: 14400,
      rejected: 120,
      failed: 18,
      bytes: 2616000,
    },
    breakdown: rows.map(([eventType, events, estimated, bytes]) => ({
      bucket: "2026-09-02T00:00:00.000Z",
      eventType,
      outcome: "accepted",
      reason: "",
      events,
      estimated,
      bytes,
    })),
  };
}

// A short but non-degenerate series, so the dashboard's trend panels have
// something to draw. An empty series only ever exercised their empty states.
function overviewSeries() {
  return Array.from({ length: 6 }, (_, index) => {
    const pageViews = 1200 + index * 180;
    return {
      bucket: new Date(Date.UTC(2026, 8, 2, index)).toISOString(),
      pageViews: { value: pageViews, samples: pageViews },
      uniqueUsers: { value: 400 + index * 40, samples: 400, approximate: true },
      errorRate: {
        value: 0.012 + index * 0.002,
        numerator: 14 + index,
        denominator: pageViews,
        numeratorSamples: 14 + index,
        denominatorSamples: pageViews,
      },
      apiFailureRate: {
        value: 0.03 + index * 0.004,
        numerator: 9 + index,
        denominator: 300,
        numeratorSamples: 9 + index,
        denominatorSamples: 300,
      },
      lcp: { p75: 2200 + index * 90, samples: 300, sufficient: true },
      inp: { p75: 160 + index * 6, samples: 300, sufficient: true },
      cls: { p75: 0.06 + index * 0.004, samples: 300, sufficient: true },
    };
  });
}

// Derived from the series rather than written independently, so the KPI cards
// and the trend panels cannot disagree about the same range.
function overviewKpis(series: ReturnType<typeof overviewSeries>) {
  const total = (pick: (point: (typeof series)[number]) => number) =>
    series.reduce((sum, point) => sum + pick(point), 0);
  const pageViews = total((point) => point.pageViews.value);
  const errors = total((point) => point.errorRate.numerator);
  const apiFailures = total((point) => point.apiFailureRate.numerator);
  const apiRequests = total((point) => point.apiFailureRate.denominator);
  const last = series[series.length - 1];
  return {
    pageViews: { value: pageViews, samples: pageViews },
    uniqueUsers: { value: 1180, samples: 1180, approximate: true },
    errorRate: {
      value: errors / pageViews,
      numerator: errors,
      denominator: pageViews,
      numeratorSamples: errors,
      denominatorSamples: pageViews,
    },
    apiFailureRate: {
      value: apiFailures / apiRequests,
      numerator: apiFailures,
      denominator: apiRequests,
      numeratorSamples: apiFailures,
      denominatorSamples: apiRequests,
    },
    lcp: { p75: last.lcp.p75, samples: 1800, sufficient: true },
    inp: { p75: last.inp.p75, samples: 1800, sufficient: true },
    cls: { p75: last.cls.p75, samples: 1800, sufficient: true },
  };
}

function overview() {
  const series = overviewSeries();
  const kpis = overviewKpis(series);
  return {
    from: "2026-09-02T00:00:00.000Z",
    to: now,
    intervalSeconds: 300,
    kpis,
    comparison: {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-02T00:00:00.000Z",
      previous: kpis,
      changes: {
        pageViewsPercent: 0,
        uniqueUsersPercent: 0,
        errorRatePoints: 0,
        apiFailureRatePoints: 0,
        lcpPercent: null,
        inpPercent: null,
        clsPercent: null,
      },
    },
    series,
    topIssues: [
      {
        fingerprint: "v1:e2e-0",
        title: "TypeError: checkout amount is undefined",
        events: 1240,
        users: 386,
        lastSeenAt: now,
      },
    ],
    slowApis: [],
    freshness: { latestReceivedAt: now, ageSeconds: 0, stale: false },
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
