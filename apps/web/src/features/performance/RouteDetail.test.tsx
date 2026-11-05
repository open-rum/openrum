// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RouteDetail } from "./RouteDetail";

beforeAll(() => {
  // jsdom has no layout; report a fixed size so charts render.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width: 640, height: 240 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const metric = (p75: number, samples = 100) => ({
  p50: p75 * 0.7,
  p75,
  p95: p75 * 1.6,
  samples,
  sufficient: samples >= 50,
});
const summary = (lcp: number) => ({
  route: "/checkout",
  pageViews: 1284,
  lcp: metric(lcp),
  inp: metric(520),
  cls: metric(0.31),
  fcp: metric(2900),
  ttfb: metric(1620),
});
const detail = {
  route: "/checkout",
  metric: "LCP" as const,
  trend: [
    { bucket: "2026-11-08T00:00:00Z", metric: metric(4000) },
    { bucket: "2026-11-08T12:00:00Z", metric: metric(4400) },
  ],
  distribution: [
    { from: 2000, to: 2250, samples: 20 },
    { from: 3000, to: 3250, samples: 20 },
    { from: 4500, to: 4750, samples: 50 },
    { from: 5000, to: 5250, samples: 10, overflow: true },
  ],
  browsers: [
    { value: "Chrome", metric: metric(2800, 60) },
    { value: "Chrome Android", metric: metric(5100, 40) },
  ],
  deviceTypes: [{ value: "mobile", metric: metric(4900, 100) }],
  countries: [
    { value: "CN", metric: metric(4000, 70) },
    { value: "IN", metric: metric(6400, 30) },
  ],
  releases: [
    { value: "v2.3.0", metric: metric(3120, 30), firstSeen: "2026-11-08T00:10:00Z" },
    { value: "v2.3.1", metric: metric(4720, 70), firstSeen: "2026-11-08T12:30:00Z" },
  ],
  samples: [
    {
      eventId: "e1",
      timestamp: "2026-11-08T21:52:00Z",
      value: 11840,
      pageUrl: "/checkout?step=payment",
      browser: "Chrome Android",
      deviceType: "mobile",
      country: "IN",
      release: "v2.3.1",
      sessionId: "s-1",
    },
  ],
};

function mount(overrides: Partial<Parameters<typeof RouteDetail>[0]> = {}) {
  const onMetricChange = vi.fn();
  const view = render(
    <RouteDetail
      projectId="p1"
      detail={detail}
      summary={summary(4210)}
      previousSummary={summary(3050)}
      previousTrend={[{ bucket: "2026-11-01T12:00:00Z", metric: metric(3000) }]}
      durationMs={7 * 86400000}
      percentile="p75"
      onMetricChange={onMetricChange}
      {...overrides}
    />,
  );
  return { ...view, onMetricChange };
}

describe("RouteDetail", () => {
  it("states the facts and compares with the previous period without a verdict on cause", () => {
    const { container } = mount();
    const line = container.querySelector("[data-route-summary]")!.textContent!;
    expect(line).toContain("LCP P75 4210 ms");
    expect(line).toContain("较差");
    expect(line).toContain("上一周期 3050 ms");
    expect(line).toContain("+38.0%");
    // 50 + 10 of 100 samples are above 4000ms.
    expect(line).toContain("60%");
    expect(line).not.toMatch(/变差|导致|原因/);
    // The two newest releases side by side, newest first, with no verdict.
    expect(container.querySelector("[data-release-compare]")!.textContent).toBe(
      "v2.3.14720 msvsv2.3.03120 ms",
    );
    expect(container.querySelector("[data-rating-shares]")!.textContent).toContain("良好 20%");
  });

  it("shows no change when the previous window has not loaded", () => {
    const { container } = mount({ previousSummary: undefined, previousTrend: undefined });
    expect(container.querySelector("[data-route-summary]")!.textContent).toContain("上一周期 —");
    expect(screen.getAllByText("上一周期无对比")).toHaveLength(5);
  });

  it("switches the metric from the picker", async () => {
    const { onMetricChange } = mount();
    const picker = screen.getByRole("group", { name: "选择指标" });
    expect(screen.getByRole("button", { name: /^LCP/ }).getAttribute("aria-pressed")).toBe("true");
    expect(picker.textContent).toContain("环比 +38.0%");
    await userEvent.click(screen.getByRole("button", { name: /^INP/ }));
    expect(onMetricChange).toHaveBeenCalledWith("INP");
  });

  it("draws the previous period beside the current trend and the histogram", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".recharts-line")).toHaveLength(2));
    // Per-bucket colours come from bucketRating, covered in routeDetailModel.test.ts.
    await waitFor(() => expect(container.querySelectorAll(".recharts-bar")).toHaveLength(1));
  });

  it("breaks down by device, browser, region and release, slowest first", async () => {
    mount();
    const table = screen.getByRole("region", { name: "影响了谁" });
    const tabs = screen.getByRole("group", { name: "拆分维度" });
    expect([...tabs.querySelectorAll("button")].map((tab) => tab.textContent)).toEqual([
      "设备",
      "浏览器",
      "地区",
      "版本",
    ]);
    expect(table.querySelector("tbody")!.textContent).toContain("Mobile");
    await userEvent.click(screen.getByRole("button", { name: "浏览器" }));
    const rows = [...table.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows[0]).toContain("Chrome Android");
    expect(rows[0]).toContain("40%");
    await userEvent.click(screen.getByRole("button", { name: "地区" }));
    expect(table.querySelector("tbody tr")!.textContent).toContain("6400 ms");
    await userEvent.click(screen.getByRole("button", { name: "版本" }));
    expect(table.querySelector("tbody tr")!.textContent).toContain("v2.3.1");
  });

  it("lists slow samples with region and release", () => {
    mount();
    const samples = screen.getByRole("region", { name: "最慢样本" });
    expect(samples.textContent).toContain("11840 ms");
    expect(samples.textContent).toContain("IN");
    expect(samples.textContent).toContain("v2.3.1");
    const link = screen.getByRole("link", { name: "查看会话" });
    expect(link.getAttribute("href")).toMatch(/^\/projects\/p1\/sessions\/s-1\?.*event=e1/);
  });
});
