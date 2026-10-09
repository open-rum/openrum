// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BehaviorAnalyticsResponse, BehaviorFilters } from "@/lib/api/analytics";
import { EventExplorer } from "./EventExplorer";

vi.mock("@/lib/api/analytics", async (original) => ({
  ...(await original<typeof import("@/lib/api/analytics")>()),
  getBehaviorSamples: vi.fn().mockResolvedValue({ samples: [], limit: 50 }),
}));
vi.mock("@/features/analytics/BehaviorTrendChart", () => ({
  BehaviorTrendChart: () => <div data-testid="trend" />,
}));

afterEach(cleanup);

const metric = (events: number, users = events) => ({
  events,
  estimated: events,
  uniqueUsers: users,
  uniqueSessions: users,
  approximate: true,
});
const filters: BehaviorFilters = {
  projectId: "p1",
  from: new Date("2026-09-03T00:00:00Z"),
  to: new Date("2026-09-03T06:00:00Z"),
  dimension: "country",
  environment: "production",
};
function response(overrides: Partial<BehaviorAnalyticsResponse> = {}): BehaviorAnalyticsResponse {
  return {
    from: "2026-09-03T00:00:00Z",
    to: "2026-09-03T06:00:00Z",
    dimension: "country",
    interval: "5 MINUTE",
    totals: metric(955, 230),
    trend: [],
    breakdown: [
      { value: "CN", metric: metric(700) },
      { value: "US", metric: metric(255) },
    ],
    catalog: [
      { kind: "page_view", name: "page_view", metric: metric(900, 200) },
      { kind: "custom", name: "order_completed", metric: metric(55, 30) },
    ],
    properties: [{ name: "tier", events: 55, cardinality: 3 }],
    measurements: [],
    freshness: { latestReceivedAt: "2026-09-03T05:59:00Z", ageSeconds: 30, stale: false },
    sampleCount: 955,
    rowLimit: 12,
    ...overrides,
  };
}
function mount(
  data: BehaviorAnalyticsResponse,
  handlers: Partial<Parameters<typeof EventExplorer>[0]> = {},
) {
  const props = {
    filters,
    onSelectEvent: vi.fn(),
    onSelectProperty: vi.fn(),
    onSelectMeasurement: vi.fn(),
    ...handlers,
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EventExplorer data={data} {...props} />
    </QueryClientProvider>,
  );
  return props;
}

describe("event explorer", () => {
  it("renders the breakdown and totals the dimension filter selects", () => {
    mount(response());
    expect(screen.getByRole("heading", { name: "国家 分布" })).toBeTruthy();
    expect(screen.getByText("中国")).toBeTruthy();
    expect(screen.getByText("73.3%")).toBeTruthy();
    expect(screen.getByLabelText("所选事件的核心指标")).toBeTruthy();
    expect(screen.getByText(/数据更新于 30 秒前/)).toBeTruthy();
  });

  it("selects a catalog event with Enter and Space, and marks the selected row", () => {
    const props = mount(response());
    const row = screen.getByText("order_completed").closest("tr")!;
    fireEvent.keyDown(row, { key: " " });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(props.onSelectEvent).toHaveBeenCalledTimes(2);
    expect(props.onSelectEvent).toHaveBeenCalledWith("custom", "order_completed");
  });

  it("toggles a property breakdown off when it is already the active one", () => {
    const props = mount(response({ dimension: "property:tier" }), {
      filters: { ...filters, dimension: "property:tier" },
    });
    const button = screen.getByRole("button", { name: /tier/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(props.onSelectProperty).toHaveBeenCalledWith(undefined);
  });

  it("hides the measurements panel unless the selection has measurements", () => {
    mount(response());
    expect(screen.queryByRole("heading", { name: "数值指标" })).toBeNull();
    cleanup();
    mount(
      response({
        measurements: [
          {
            name: "order_value",
            samples: 10,
            total: 100,
            estimated: 100,
            average: 10,
            minimum: 1,
            maximum: 30,
            p50: 9,
            p90: 25,
          },
        ],
      }),
    );
    const panel = screen.getByRole("heading", { name: "数值指标" }).closest("section")!;
    expect(within(panel).getByText("order_value")).toBeTruthy();
  });

  it("explains the empty range and points at the next step", () => {
    mount(response({ catalog: [], totals: metric(0), breakdown: [], trend: [] }));
    expect(screen.getByText("当前范围没有事件")).toBeTruthy();
    expect(screen.getByRole("link", { name: "接入 SDK" }).getAttribute("href")).toBe(
      "/projects/p1/onboarding",
    );
  });

  it("asks for an event before showing raw samples", () => {
    mount(response());
    expect(screen.getByText("选择一个事件")).toBeTruthy();
  });
});
