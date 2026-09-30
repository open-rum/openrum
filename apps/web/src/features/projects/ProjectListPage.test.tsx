// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function overview(from: string, to: string, intervalSeconds: number, series: unknown[] = []) {
  return {
    from,
    to,
    intervalSeconds,
    kpis,
    series,
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

function point(bucket: string, pageViews: number) {
  return {
    bucket,
    pageViews: { value: pageViews, samples: pageViews },
    uniqueUsers: { value: 0, samples: 0, approximate: true },
    errorRate: rate,
    apiFailureRate: rate,
    lcp: vital,
    inp: vital,
    cls: vital,
  };
}

/** Answers the 24-hour table summary and the 30-day heatmap request differently. */
function overviewHandler(requests: string[]) {
  return http.get("/api/v1/projects/project/overview", ({ request }) => {
    const url = new URL(request.url);
    const span =
      Date.parse(url.searchParams.get("to")!) - Date.parse(url.searchParams.get("from")!);
    const daily = span > 2 * 86400_000;
    requests.push(`${daily ? "30d" : "24h"}:${url.searchParams.get("maxPoints")}`);
    return HttpResponse.json(
      daily
        ? overview("2026-09-01T00:00:00Z", "2026-09-30T08:00:00Z", 86400, [
            point("2026-09-28T00:00:00Z", 1200),
            point("2026-09-29T00:00:00Z", 300),
          ])
        : overview("2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z", 3600),
    );
  });
}

describe("project display modes", () => {
  it("defaults to the table, switches to heatmap cards and restores the preference", async () => {
    projectHandlers();
    const requests: string[] = [];
    server.use(overviewHandler(requests));
    const user = userEvent.setup();
    const view = renderPage();

    expect(await view.findByRole("table")).toBeTruthy();
    expect(await view.findByText("≈0")).toBeTruthy();
    expect(view.getByRole("radio", { name: "表格" }).getAttribute("aria-checked")).toBe("true");

    await user.click(view.getByRole("radio", { name: "卡片" }));
    const heatmap = await view.findByRole("img", { name: /^近 30 天 PV：活跃 2 天/ });
    expect(heatmap.getAttribute("aria-label")).toContain("峰值 9月28日");
    expect(view.getByText("2/30")).toBeTruthy();
    expect(requests).toEqual(["24h:30", "30d:30"]);
    expect(localStorage.getItem("openrum-project-list-view")).toBe("cards");

    view.unmount();
    const restored = renderPage();
    await waitFor(() =>
      expect(restored.getByRole("radio", { name: "卡片" }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
  });

  it("falls back to the table for layouts from earlier versions", async () => {
    projectHandlers();
    localStorage.setItem("openrum-project-list-view", "compact");
    server.use(overviewHandler([]));
    const view = renderPage();
    expect(await view.findByRole("table")).toBeTruthy();
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
      "/projects/project/analytics",
    );
  });
});
