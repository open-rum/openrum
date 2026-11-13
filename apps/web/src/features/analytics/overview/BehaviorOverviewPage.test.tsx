// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MetricsQueryParams, MetricsResult } from "@/lib/api/metricsQuery";
import { queryMetrics } from "@/lib/api/metricsQuery";
import { BehaviorOverviewPage } from "./BehaviorOverviewPage";

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ projectId: "p1" }),
  useNavigate: () => vi.fn(),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className} href="#funnels">
      {children}
    </a>
  ),
}));
const projectCurrency = vi.hoisted(() => ({ code: "" }));
vi.mock("@/lib/api/projects", () => ({
  listOrganizations: vi.fn(async () => ({ organizations: [{ id: "o1" }] })),
  listProjects: vi.fn(async () => ({
    projects: [{ id: "p1", name: "Store", revenueCurrency: projectCurrency.code }],
  })),
}));
vi.mock("@/features/filters/AnalysisContextBar", () => ({
  useAnalysisContext: () => ({
    projectId: "p1",
    from: new Date("2026-11-01T00:00:00Z"),
    to: new Date("2026-11-08T00:00:00Z"),
    environment: "production",
  }),
}));
vi.mock("@/lib/api/analytics", () => ({
  queryFunnel: vi.fn(async () => ({
    steps: [
      {
        name: "view_item",
        kind: "custom",
        index: 1,
        sessions: 1000,
        conversionFromPrevious: null,
        conversionFromFirst: 1,
      },
      {
        name: "add_to_cart",
        kind: "custom",
        index: 2,
        sessions: 250,
        conversionFromPrevious: 0.25,
        conversionFromFirst: 0.25,
      },
      {
        name: "begin_checkout",
        kind: "custom",
        index: 3,
        sessions: 120,
        conversionFromPrevious: 0.48,
        conversionFromFirst: 0.12,
      },
      {
        name: "purchase",
        kind: "custom",
        index: 4,
        sessions: 60,
        conversionFromPrevious: 0.5,
        conversionFromFirst: 0.06,
      },
    ],
  })),
}));
vi.mock("@/lib/api/metricsQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/metricsQuery")>()),
  queryMetrics: vi.fn(),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  projectCurrency.code = "";
  vi.mocked(queryMetrics).mockReset();
});

const v = (value: number) => ({ value, samples: 10, sufficient: true });
function respond(revenueSamples: number) {
  vi.mocked(queryMetrics).mockImplementation(async (params: MetricsQueryParams) => {
    // Mirrors the catalog: metrics drawn together must share a unit.
    if (params.metrics.includes("measurement.estimated") && params.metrics.length > 1)
      throw new Error("metrics drawn together must share a unit");
    const metric = params.metrics[0];
    const rows = (values: Record<string, number>) =>
      Object.entries(values).map(([value, number]) => ({ value, values: { [metric]: v(number) } }));
    const result = (extra: Partial<MetricsResult>) =>
      ({
        shape: params.shape,
        metrics: [],
        limitReached: false,
        freshness: {},
        ...extra,
      }) as MetricsResult;
    if (params.shape === "series") {
      const totals: Record<string, ReturnType<typeof v>> = {
        // The revenue total carries the number of stored amounts behind it.
        "measurement.estimated": {
          value: revenueSamples ? 1_353_000 : 0,
          samples: revenueSamples,
          sufficient: true,
        },
        "behavior.events": v(revenueSamples),
        "traffic.sessions": v(371_300),
        "traffic.uniqueUsers": v(268_400),
        "behavior.sessions": v(11_500),
        "behavior.users": v(52),
      };
      const pick = (source: Record<string, ReturnType<typeof v>>) =>
        Object.fromEntries(params.metrics.map((id) => [id, source[id]]));
      return result({
        totals: pick(totals),
        comparison: {
          from: "",
          to: "",
          offsetSeconds: 0,
          totals: pick({
            ...totals,
            "measurement.estimated": v(1_203_700),
            "behavior.events": v(revenueSamples ? 10_400 : 0),
          }),
        },
        series: params.metrics.map((id) => ({ metric: id, points: [v(1), v(2), null, v(3)] })),
      });
    }
    if (params.dimension === "source")
      return result({
        rows:
          metric === "measurement.estimated"
            ? rows({ direct: 532_300, "google.com": 181_600 })
            : rows({ direct: 128_400, "google.com": 52_100 }),
      });
    if (metric === "behavior.users") return result({ rows: rows({ CN: 30, US: 12, JP: 10 }) });
    if (metric === "traffic.sessions")
      return result({ rows: rows({ CN: 1000, US: 4000, JP: 400 }) });
    if (metric === "measurement.estimated") return result({ rows: rows({ CN: 9000, JP: 2400 }) });
    return result({ rows: rows({ CN: 36, US: 20, JP: 12 }) });
  });
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BehaviorOverviewPage />
    </QueryClientProvider>,
  );
}

describe("behaviour overview", () => {
  it("leads with active users on the map and switches what the map ranks", async () => {
    respond(10_900);
    mount();
    expect(await screen.findByRole("heading", { name: "过去 30 分钟活跃用户" })).toBeTruthy();
    expect(await screen.findByText("52")).toBeTruthy();
    const ranking = screen.getByRole("complementary", { name: "地区排行" });
    await waitFor(() =>
      expect(within(ranking).getAllByRole("button")[0].textContent).toContain("中国"),
    );

    fireEvent.click(screen.getByRole("radio", { name: "会话" }));
    expect(screen.getByRole("radio", { name: "会话" }).getAttribute("aria-checked")).toBe("true");
    await waitFor(() =>
      expect(within(ranking).getAllByRole("button")[0].textContent).toContain("美国"),
    );

    const japan = within(ranking).getByRole("button", { name: /日本/ });
    fireEvent.click(japan);
    expect(japan.getAttribute("aria-pressed")).toBe("true");
    // The map loads its outlines on demand and shades every ranked country.
    await waitFor(() =>
      expect(document.querySelector('[data-country="US"]')?.getAttribute("data-level")).toBe("5"),
    );
    expect(document.querySelector('[data-country="JP"]')?.getAttribute("fill")).toBe(
      "var(--color-accent)",
    );
    // The selection is labelled on the map until another country is pointed at.
    expect(document.querySelector(".overview-map-callout")?.textContent).toContain("日本");

    // Pointing at a country shows its figures beside the pointer.
    fireEvent.pointerMove(document.querySelector('[data-country="US"]')!);
    const label = document.querySelector(".overview-map-callout");
    expect(label?.textContent).toContain("美国");
    expect(label?.textContent).toContain("会话4,000");
    fireEvent.pointerMove(document.querySelector('[data-country="BR"]')!);
    expect(document.querySelector(".overview-map-callout")?.textContent).toContain(
      "当前范围没有数据",
    );
    fireEvent.pointerLeave(document.querySelector("svg[role=img]")!);
    expect(document.querySelector(".overview-map-callout")?.textContent).toContain("日本");
  });

  it("shows revenue with its previous period, the funnel and sources", async () => {
    respond(10_900);
    mount();
    const kpis = await screen.findByRole("region", { name: "收入概览" });
    await waitFor(() => expect(within(kpis).getByText("135.3万")).toBeTruthy());
    expect(within(kpis).getByText("上一周期 120.4万 · ↑ 12.4%")).toBeTruthy();
    expect(within(kpis).getByText("3.10%")).toBeTruthy();
    expect(await screen.findByText("浏览商品")).toBeTruthy();
    expect(screen.getByText("上一步 25.0%")).toBeTruthy();
    expect(await screen.findByText("直接访问")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("labels revenue with the Project's currency", async () => {
    projectCurrency.code = "USD";
    respond(10_900);
    mount();
    const kpis = await screen.findByRole("region", { name: "收入概览" });
    await waitFor(() => expect(within(kpis).getByText("US$135.3万")).toBeTruthy());
    expect(within(kpis).getByText("上一周期 US$120.4万 · ↑ 12.4%")).toBeTruthy();
  });

  it("explains the e-commerce events when there is no revenue", async () => {
    respond(0);
    mount();
    expect((await screen.findByRole("status")).textContent).toContain("purchase");
  });
});
