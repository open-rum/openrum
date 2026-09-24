// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OrganizationUsagePage } from "./OrganizationUsagePage";
import { emptyTotals } from "./organizationUsage";

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function renderPage() {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/usage",
    component: OrganizationUsagePage,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ["/usage?from=2026-09-20T00:00:00Z&to=2026-09-21T00:00:00Z"],
    }),
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function fixtures() {
  server.use(
    http.get("/api/v1/organizations", () =>
      HttpResponse.json({ organizations: [{ id: "org", name: "团队" }] }),
    ),
    http.get("/api/v1/organizations/org/projects", () =>
      HttpResponse.json({
        projects: [
          { id: "one", name: "商城", slug: "shop" },
          { id: "two", name: "官网", slug: "site" },
        ],
      }),
    ),
  );
}
const response = (accepted: number) => ({
  from: "2026-09-20T00:00:00Z",
  to: "2026-09-21T00:00:00Z",
  intervalSeconds: 3600,
  totals: { ...emptyTotals(), accepted },
  breakdown: [
    {
      bucket: "2026-09-20T12:00:00Z",
      eventType: "error",
      outcome: "accepted",
      reason: "",
      events: accepted,
      estimated: accepted,
      bytes: 0,
    },
  ],
});

describe("organization usage page", () => {
  it("compares projects, filters via the API and carries the range into project detail", async () => {
    fixtures();
    const requests: URL[] = [];
    server.use(
      http.get("/api/v1/projects/:id/usage", ({ params, request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json(response(params.id === "one" ? 120 : 80));
      }),
    );
    const view = renderPage();
    const user = userEvent.setup();
    const table = await view.findByRole("table");
    expect(within(table).getByText("60.0%")).toBeTruthy();
    expect(within(table).getByText("40.0%")).toBeTruthy();
    const href = within(table).getByRole("link", { name: "商城" }).getAttribute("href")!;
    expect(new URL(href, "https://example.com").searchParams.get("from")).toBe(
      "2026-09-20T00:00:00.000Z",
    );
    await user.click(view.getByRole("combobox", { name: "事件类型" }));
    await user.click(view.getByRole("option", { name: "错误" }));
    await waitFor(() =>
      expect(requests.filter((url) => url.searchParams.get("eventType") === "error")).toHaveLength(
        2,
      ),
    );
    await view.findByRole("table");
    await user.type(view.getByRole("textbox", { name: "搜索项目" }), "shop");
    expect(within(view.getByRole("table")).queryByText("官网")).toBeNull();
    expect(within(view.getByLabelText("组织用量摘要")).getByText("200")).toBeTruthy();
  });
  it("excludes failed projects and suppresses misleading shares", async () => {
    fixtures();
    server.use(
      http.get("/api/v1/projects/:id/usage", ({ params }) =>
        params.id === "two"
          ? HttpResponse.json({}, { status: 503 })
          : HttpResponse.json(response(120)),
      ),
    );
    const view = renderPage();
    expect(await view.findByText("部分项目用量不可用")).toBeTruthy();
    expect(view.getByText("查询失败，未计入汇总")).toBeTruthy();
    expect(view.queryByText("100.0%")).toBeNull();
  });
});
