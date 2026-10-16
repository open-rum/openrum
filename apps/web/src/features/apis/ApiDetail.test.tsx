// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { APIFilters } from "@/lib/api/apis";
import { ApiDetail } from "./ApiDetail";

vi.mock("@/lib/api/apis", async (original) => ({
  ...(await original<typeof import("@/lib/api/apis")>()),
  getAPISamples: vi.fn().mockResolvedValue({ samples: [], truncated: false }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // vaul captures the pointer on press; jsdom has no pointer capture.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
});
afterEach(cleanup);

const detail = {
  endpoint: {
    method: "GET",
    url: "/api/products/:id",
    requests: 120,
    estimated: 120,
    failures: 2,
    clientErrors: 1,
    serverErrors: 1,
    networkErrors: 0,
    p50: 80,
    p75: 120,
    p95: 240,
    sufficient: true,
  },
  trend: [],
  routes: [],
  statuses: [],
  latency: [],
  payload: { samples: 0, p50: null, p95: null },
  dimensions: {
    browsers: [],
    operatingSystems: [],
    devices: [],
    countries: [],
    releases: [],
  },
};
const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
const filters: APIFilters = {
  projectId,
  from: new Date("2026-09-02T22:00:00.000Z"),
  to: new Date("2026-09-03T00:00:00.000Z"),
  methods: [],
  method: "GET",
  url: "/api/products/:id",
  sort: "requests",
};
const range = {
  from: "2026-09-02T22:00:00.000Z",
  to: "2026-09-03T00:00:00.000Z",
  interval: "1 HOUR",
};

describe("ApiDetail", () => {
  it("renders as an accessible drawer and closes from its control", () => {
    const onClose = vi.fn();
    render(
      <ApiDetail
        detail={detail}
        range={range}
        filters={filters}
        projectId={projectId}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "/api/products/:id" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows request count, request time and status as three charts", () => {
    render(
      <ApiDetail
        detail={{
          ...detail,
          trend: [
            {
              bucket: "2026-09-02T22:00:00.000Z",
              requests: 720,
              failures: 12,
              clientErrors: 30,
              serverErrors: 8,
              networkErrors: 4,
              p50: 90,
              p75: 300,
              p95: 610,
            },
            {
              bucket: "2026-09-02T23:00:00.000Z",
              requests: 840,
              failures: 21,
              clientErrors: 26,
              serverErrors: 15,
              networkErrors: 6,
              p50: 95,
              p75: 320,
              p95: 680,
            },
          ],
        }}
        range={range}
        filters={filters}
        projectId={projectId}
        onClose={vi.fn()}
      />,
    );

    const drawer = within(screen.getByRole("dialog"));
    expect(drawer.getByRole("heading", { name: "请求数" })).toBeTruthy();
    expect(drawer.getByRole("heading", { name: "请求耗时" })).toBeTruthy();
    expect(drawer.getByRole("heading", { name: "状态码" })).toBeTruthy();
    expect(drawer.queryByText("当前范围暂无数据")).toBeNull();
  });

  it("explains an empty trend in each chart instead of rendering a blank one", () => {
    render(
      <ApiDetail
        detail={detail}
        range={range}
        filters={filters}
        projectId={projectId}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByText("当前范围暂无数据")).toHaveLength(3);
  });

  it("breaks failures down by exact status code", () => {
    render(
      <ApiDetail
        detail={{
          ...detail,
          statuses: [
            { status: 200, requests: 900 },
            { status: 429, requests: 80 },
            { status: 0, failure: "network", requests: 20 },
          ],
          latency: [
            { fromMs: 0, toMs: 100, requests: 700 },
            { fromMs: 3000, toMs: null, requests: 12 },
          ],
          payload: { samples: 900, p50: 2048, p95: 51200 },
        }}
        range={range}
        filters={filters}
        projectId={projectId}
        onClose={vi.fn()}
      />,
    );

    const statuses = within(screen.getByRole("list", { name: "响应状态码分布" }));
    expect(statuses.getByText("429")).toBeTruthy();
    expect(statuses.getByText("network")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "延迟分布" })).getByText("≥ 3s")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("opens on the trend and moves to the individual requests under 请求样本", async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ApiDetail
          detail={detail}
          range={range}
          filters={filters}
          projectId={projectId}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const tabs = within(screen.getByRole("tablist"));
    expect(tabs.getByRole("tab", { name: "趋势" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "请求数" })).toBeTruthy();
    expect(screen.queryByLabelText("按用户 ID 搜索请求")).toBeNull();

    await userEvent.setup().click(tabs.getByRole("tab", { name: /请求样本/ }));
    expect(await screen.findByLabelText("按用户 ID 搜索请求")).toBeTruthy();
  });

  function mountWith(requests: number) {
    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ApiDetail
          detail={{ ...detail, endpoint: { ...detail.endpoint, requests } }}
          range={range}
          filters={filters}
          projectId={projectId}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
  }

  it("names both tabs, and says how many requests the second one holds", () => {
    mountWith(120);
    const tabs = within(screen.getByRole("tablist", { name: "端点详情分区" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "趋势",
      "请求样本100+",
    ]);
    // Neither label repeats the drawer's own name, which the close button already carries.
    expect(tabs.queryByRole("tab", { name: "详情" })).toBeNull();
  });

  it("shows the exact count below the list limit and none for an endpoint without requests", () => {
    const first = mountWith(37);
    expect(screen.getByRole("tab", { name: /请求样本/ }).textContent).toBe("请求样本37");
    first.unmount();
    mountWith(0);
    expect(screen.getByRole("tab", { name: /请求样本/ }).textContent).toBe("请求样本");
  });

  it("keeps the header to one line and puts the privacy note behind an info button", async () => {
    mountWith(3);
    const description = screen.getByText(/只展示标准化 URL 和安全上下文/);
    expect(description.textContent).not.toMatch(/Cookie/);
    await userEvent.setup().hover(screen.getByRole("button", { name: "查看隐私说明" }));
    const note = await screen.findAllByText(/不含 query、body 和 Cookie/);
    expect(note.length).toBeGreaterThan(0);
  });

  it("flags a dimension whose P95 runs well above the endpoint baseline", () => {
    render(
      <ApiDetail
        detail={{
          ...detail,
          dimensions: {
            ...detail.dimensions,
            browsers: [
              { value: "Chrome", requests: 900, failures: 2, p95: 220 },
              { value: "Safari", requests: 120, failures: 30, p95: 1480 },
            ],
          },
        }}
        range={range}
        filters={filters}
        projectId={projectId}
        onClose={vi.fn()}
      />,
    );

    // The fixture endpoint reports a 240 ms P95, so only Safari exceeds it by 25%.
    expect(screen.getAllByText("高于整体 P95")).toHaveLength(1);
  });
});
