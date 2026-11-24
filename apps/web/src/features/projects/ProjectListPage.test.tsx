// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ProjectListPage } from "./ProjectListPage";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({ component: ProjectListPage }),
    history: createMemoryHistory(),
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function projectHandlers() {
  server.use(
    http.get("/api/v1/organizations", () =>
      HttpResponse.json({ organizations: [{ id: "org", name: "团队", role: "owner" }] }),
    ),
    http.get("/api/v1/organizations/org/projects", () =>
      HttpResponse.json({
        projects: [
          {
            id: "project",
            name: "商城",
            slug: "shop",
            sdkPlatform: "vue",
            environment: "production",
            environments: ["production", "test"],
            status: "active",
            retentionDays: 14,
            eventSampleRate: 1,
          },
        ],
      }),
    ),
  );
}

const count = { value: 0, samples: 0 };
const rate = {
  value: null,
  numerator: 0,
  denominator: 0,
  numeratorSamples: 0,
  denominatorSamples: 0,
};
const vital = { p75: null, samples: 0, sufficient: false };
const kpis = {
  pageViews: count,
  uniqueUsers: { ...count, approximate: true },
  errorRate: rate,
  apiFailureRate: rate,
  lcp: vital,
  inp: vital,
  cls: vital,
};

function overview(from: string, to: string, intervalSeconds: number) {
  return {
    from,
    to,
    intervalSeconds,
    kpis,
    series: [],
    topIssues: [],
    freshness: { latestReceivedAt: null, ageSeconds: null, stale: false },
    comparison: {
      from,
      to,
      previous: kpis,
      changes: {
        pageViewsPercent: null,
        uniqueUsersPercent: null,
        errorRatePoints: null,
        apiFailureRatePoints: null,
        lcpPercent: null,
        inpPercent: null,
        clsPercent: null,
      },
    },
  };
}

function overviewHandler(requests: string[]) {
  return http.get("/api/v1/projects/project/overview", ({ request }) => {
    requests.push(new URL(request.url).searchParams.get("maxPoints")!);
    return HttpResponse.json(overview("2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z", 3600));
  });
}

describe("project list", () => {
  it("offers one create action when the organization has no projects", async () => {
    server.use(
      http.get("/api/v1/organizations", () =>
        HttpResponse.json({ organizations: [{ id: "org", name: "团队", role: "owner" }] }),
      ),
      http.get("/api/v1/organizations/org/projects", () => HttpResponse.json({ projects: [] })),
    );
    const view = renderPage();
    await view.findByRole("heading", { name: "创建你的第一个项目" });
    const links = view.getAllByRole("link", { name: "创建项目" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/projects/new");
  });

  it("keeps the permission explanation without an actionable create link for members", async () => {
    server.use(
      http.get("/api/v1/organizations", () =>
        HttpResponse.json({ organizations: [{ id: "org", name: "团队", role: "member" }] }),
      ),
      http.get("/api/v1/organizations/org/projects", () => HttpResponse.json({ projects: [] })),
    );
    const view = renderPage();
    await view.findByText("当前角色不能创建项目，请联系组织 Owner 或 Admin。");
    expect(view.queryByRole("link", { name: "创建项目" })).toBeNull();
  });

  it("shows every project in the 24-hour table", async () => {
    projectHandlers();
    const requests: string[] = [];
    server.use(overviewHandler(requests));
    const view = renderPage();
    expect(await view.findByRole("table")).toBeTruthy();
    expect(await view.findByText("≈0")).toBeTruthy();
    expect(view.queryByRole("radio")).toBeNull();
    expect(requests).toEqual(["30"]);
  });

  it("links every project to its settings", async () => {
    projectHandlers();
    server.use(overviewHandler([]));
    const view = renderPage();
    const link = await view.findByRole("link", { name: "项目设置：商城" });
    expect(link.getAttribute("href")).toBe("/settings/project/project/general");
  });

  it("does not disguise failed summaries as zero metrics and keeps entry available", async () => {
    projectHandlers();
    server.use(
      http.get("/api/v1/projects/project/overview", () =>
        HttpResponse.json({ error: { message: "unavailable" } }, { status: 503 }),
      ),
    );
    const view = renderPage();
    expect(await view.findByText("摘要暂不可用")).toBeTruthy();
    expect(view.queryByText("≈0")).toBeNull();
    expect(view.getByRole("link", { name: /进入项目/ }).getAttribute("href")).toContain(
      "/projects/project/overview",
    );
  });
});
