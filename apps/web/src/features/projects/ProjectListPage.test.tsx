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

describe("project display modes", () => {
  it("switches all three layouts without requesting the same fresh summary again, and restores preference", async () => {
    projectHandlers();
    let requests = 0;
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
    server.use(
      http.get("/api/v1/projects/project/overview", () => {
        requests++;
        return HttpResponse.json({
          from: "2026-09-20T00:00:00Z",
          to: "2026-09-21T00:00:00Z",
          intervalSeconds: 3600,
          kpis,
          series: [],
          topIssues: [],
          freshness: { latestReceivedAt: null, ageSeconds: null, stale: false },
          comparison: {
            from: "2026-09-19T00:00:00Z",
            to: "2026-09-20T00:00:00Z",
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
        });
      }),
    );
    const user = userEvent.setup();
    const view = renderPage();
    expect(await view.findByText("等待上报")).toBeTruthy();
    await user.click(view.getByRole("radio", { name: "趋势卡片" }));
    expect(view.getByText("PV 趋势")).toBeTruthy();
    await user.click(view.getByRole("radio", { name: "数据表格" }));
    expect(view.getByRole("table")).toBeTruthy();
    expect(view.getByText("≈0")).toBeTruthy();
    expect(requests).toBe(1);
    expect(localStorage.getItem("openrum-project-list-view")).toBe("table");
    view.unmount();
    const restored = renderPage();
    await waitFor(() =>
      expect(restored.getByRole("radio", { name: "数据表格" }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
  });

  it("does not disguise failed summaries as zero metrics and keeps entry available", async () => {
    projectHandlers();
    localStorage.setItem("openrum-project-list-view", "table");
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
