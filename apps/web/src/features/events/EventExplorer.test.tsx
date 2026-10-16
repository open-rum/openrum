// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BehaviorAnalyticsResponse, BehaviorFilters } from "@/lib/api/analytics";
import { EventExplorer } from "./EventExplorer";

const detailResponse = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/api/analytics", async (original) => ({
  ...(await original<typeof import("@/lib/api/analytics")>()),
  getBehaviorSamples: vi.fn().mockResolvedValue({ samples: [], limit: 50 }),
  getBehaviorAnalytics: vi.fn(async () => detailResponse.current),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  window.matchMedia ??= (() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

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
  detailResponse.current = response({
    totals: metric(55, 30),
    breakdown: [{ value: "CN", metric: metric(40) }],
  });
  const props = {
    filters,
    onSelectEvent: vi.fn(),
    onChangeDimension: vi.fn(),
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
const list = () => within(screen.getByRole("region", { name: "事件列表" }));

describe("event explorer", () => {
  it("shows the four summary views and then the list, with no left-hand catalog", () => {
    mount(response());
    const headings = Array.from(document.querySelectorAll("h2")).map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(["事件趋势", "事件类型", "国家分布", "事件列表"]);
    expect(document.querySelector(".event-catalog")).toBeNull();
  });

  it("puts the totals in the trend card and explains sampling only when it matters", async () => {
    const user = userEvent.setup();
    mount(response());
    const totals = screen.getByLabelText("核心指标");
    expect(within(totals).getByText("事件")).toBeTruthy();
    expect(within(totals).getByText("用户")).toBeTruthy();
    expect(within(totals).getByText("会话")).toBeTruthy();
    const info = () => screen.getAllByRole("button", { name: "说明" })[0];
    await user.hover(info());
    expect(await screen.findAllByText(/近似去重/)).not.toHaveLength(0);
    expect(screen.queryByText(/按采样率还原/)).toBeNull();
    cleanup();
    mount(response({ totals: { ...metric(1000, 230), estimated: 1500 } }));
    await user.hover(info());
    expect((await screen.findAllByText(/按采样率还原约/)).length).toBeGreaterThan(0);
  });

  it("splits events by type and filters to a type on click", () => {
    const props = mount(response());
    const card = screen.getByRole("heading", { name: "事件类型" }).closest("section")!;
    expect(within(card).getByText("页面访问")).toBeTruthy();
    expect(within(card).getByText("94.2%")).toBeTruthy();
    // The donut's legend rows are the dashboard's own; each one filters to its type.
    fireEvent.click(within(card).getByText("自定义事件").closest("li")!);
    expect(props.onSelectEvent).toHaveBeenCalledWith("custom");
  });

  it("names countries and lets the distribution switch dimension", async () => {
    const props = mount(response());
    const card = screen.getByRole("heading", { name: "国家分布" }).closest("section")!;
    expect(within(card).getByText("中国 (CN)")).toBeTruthy();
    expect(within(card).getByText("73.3%")).toBeTruthy();
    fireEvent.click(within(card).getByRole("combobox", { name: "分布维度" }));
    fireEvent.click(await screen.findByRole("option", { name: "设备" }));
    expect(props.onChangeDimension).toHaveBeenCalledWith("device");
  });

  it("offers event properties as distribution dimensions", async () => {
    const props = mount(response());
    const card = screen.getByRole("heading", { name: "国家分布" }).closest("section")!;
    fireEvent.click(within(card).getByRole("combobox", { name: "分布维度" }));
    fireEvent.click(await screen.findByRole("option", { name: "tier" }));
    expect(props.onChangeDimension).toHaveBeenCalledWith("property:tier");
  });

  it("opens a row with Enter and Space and applies the filter only on request", async () => {
    const props = mount(response());
    const row = list().getByText("order_completed").closest("tr")!;
    fireEvent.keyDown(row, { key: "Enter" });
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "只看这个事件" })).toBeTruthy(),
    );
    expect(props.onSelectEvent).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "只看这个事件" }));
    expect(props.onSelectEvent).toHaveBeenCalledWith("custom", "order_completed");
  });

  it("shows the event's own figures, distribution and properties in the drawer", async () => {
    mount(response());
    fireEvent.click(list().getByText("order_completed").closest("tr")!);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByLabelText("该事件的核心指标")).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "趋势" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "国家分布" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "可分组属性" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "原始样本" })).toBeTruthy();
  });

  it("shows measurements in the drawer only when the event has them", async () => {
    mount(response());
    fireEvent.click(list().getByText("order_completed").closest("tr")!);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("heading", { name: "趋势" });
    expect(within(dialog).queryByRole("heading", { name: "数值指标" })).toBeNull();
  });

  it("names what is being viewed beside the figures, and clears it", () => {
    const props = mount(response());
    expect(screen.getByText("全部事件")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "清除选择" })).toBeNull();
    cleanup();
    const selected = mount(response(), {
      filters: { ...filters, eventKind: "custom", eventName: "order_completed" },
    });
    expect(screen.getByText("正在查看")).toBeTruthy();
    const bar = screen.getByText("正在查看").closest("div")!;
    expect(within(bar).getByText("order_completed")).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "清除选择" }));
    expect(selected.onSelectEvent).toHaveBeenCalledWith();
    expect(props.onSelectEvent).not.toHaveBeenCalled();
  });

  it("marks the filtered event's row as selected", () => {
    mount(response(), {
      filters: { ...filters, eventKind: "custom", eventName: "order_completed" },
    });
    expect(list().getByText("order_completed").closest("tr")?.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("warns plainly when the data is stale", () => {
    mount(
      response({
        freshness: { latestReceivedAt: "2026-09-03T05:00:00Z", ageSeconds: 2040, stale: true },
      }),
    );
    expect(screen.getByRole("status").textContent).toMatch(/数据更新于 34 分钟前，可能不是最新/);
  });

  it("explains the empty range and points at the next step", () => {
    mount(response({ catalog: [], totals: metric(0), breakdown: [], trend: [] }));
    expect(screen.getByText("当前范围没有事件")).toBeTruthy();
    expect(screen.getByRole("link", { name: "接入 SDK" }).getAttribute("href")).toBe(
      "/projects/p1/onboarding",
    );
  });
});

describe("event list", () => {
  it("shows the default columns and lets the reader choose others, remembering the choice", async () => {
    const user = userEvent.setup();
    mount(response());
    const headers = () =>
      list()
        .getAllByRole("columnheader")
        .map((header) => header.textContent);
    expect(headers()).toEqual(["事件", "次数", "占比", "用户", "会话"]);
    await user.click(list().getByRole("button", { name: "列" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /人均次数/ }));
    // An open menu hides the rest of the page from assistive technology.
    await user.keyboard("{Escape}");
    expect(headers()).toEqual(["事件", "次数", "占比", "用户", "会话", "人均次数"]);
    expect(window.localStorage.getItem("openrum:event-list-columns")).toContain("perUser");
    cleanup();
    mount(response());
    expect(headers()).toContain("人均次数");
  });

  it("will not hide the event column", async () => {
    const user = userEvent.setup();
    mount(response());
    await user.click(list().getByRole("button", { name: "列" }));
    const name = await screen.findByRole("menuitemcheckbox", { name: /^事件/ });
    expect(name.getAttribute("aria-disabled")).toBe("true");
  });

  it("sorts by a clicked header and flips on a second click", () => {
    mount(response());
    const names = () =>
      list()
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector("strong")?.textContent);
    expect(names()).toEqual(["页面访问", "order_completed"]);
    fireEvent.click(list().getByRole("button", { name: "次数" }));
    expect(names()).toEqual(["order_completed", "页面访问"]);
  });

  it("does not repeat an event's own name as its type", () => {
    mount(
      response({
        catalog: [
          { kind: "click", name: "click", metric: metric(900, 200) },
          { kind: "custom", name: "order_completed", metric: metric(55, 30) },
        ],
      }),
    );
    const clickRow = list().getByText("元素点击").closest("tr")!;
    expect(within(clickRow).getAllByText("元素点击")).toHaveLength(1);
    const customRow = list().getByText("order_completed").closest("tr")!;
    expect(within(customRow).getByText("自定义事件")).toBeTruthy();
  });

  it("shows the type in its own column once that column is on", async () => {
    const user = userEvent.setup();
    mount(response());
    await user.click(list().getByRole("button", { name: "列" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /^类型/ }));
    await user.keyboard("{Escape}");
    const row = list().getByText("order_completed").closest("tr")!;
    expect(within(row).getAllByText("自定义事件")).toHaveLength(1);
  });
});
