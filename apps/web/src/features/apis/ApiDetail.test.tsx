// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiDetail } from "./ApiDetail";

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
  samples: [],
};
const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";

describe("ApiDetail", () => {
  it("renders as an accessible drawer and closes from its control", () => {
    const onClose = vi.fn();
    render(<ApiDetail detail={detail} projectId={projectId} onClose={onClose} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "/api/products/:id" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("charts requests, P95 and failure rate on separate scales", () => {
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
              p95: 610,
            },
            {
              bucket: "2026-09-02T23:00:00.000Z",
              requests: 840,
              failures: 21,
              clientErrors: 26,
              p95: 680,
            },
          ],
        }}
        projectId={projectId}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "该 endpoint 请求量与失败构成趋势" })).toBeTruthy();
  });

  it("explains an empty trend instead of rendering a blank chart", () => {
    render(<ApiDetail detail={detail} projectId={projectId} onClose={vi.fn()} />);

    expect(screen.getByText("当前范围暂无趋势数据。")).toBeTruthy();
  });

  it("breaks failures down by exact status code and links samples to their session", () => {
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
          samples: [
            {
              eventId: "018f4d9c-83a1-76c9-81c2-3020ab667098",
              timestamp: "2026-09-02T23:30:00.000Z",
              status: 429,
              durationMs: 1830,
              route: "/products/:id",
              pageUrl: "https://shop.example/products/42",
              sessionId: "018f4d9c-83a1-76c9-81c2-3020ab667099",
            },
          ],
        }}
        projectId={projectId}
        onClose={vi.fn()}
      />,
    );

    const statuses = within(screen.getByRole("list", { name: "响应状态码分布" }));
    expect(statuses.getByText("429")).toBeTruthy();
    expect(statuses.getByText("network")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "延迟分布" })).getByText("≥ 3s")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();

    const link = screen.getByRole("link", { name: "查看会话" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("/sessions/018f4d9c-83a1-76c9-81c2-3020ab667099?");
    expect(link.getAttribute("href")).toContain("event=018f4d9c-83a1-76c9-81c2-3020ab667098");
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
        projectId={projectId}
        onClose={vi.fn()}
      />,
    );

    // The fixture endpoint reports a 240 ms P95, so only Safari exceeds it by 25%.
    expect(screen.getAllByText("高于整体 P95")).toHaveLength(1);
  });
});
