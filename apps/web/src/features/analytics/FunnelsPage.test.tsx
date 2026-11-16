// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryFunnel } from "@/lib/api/analytics";
import { FunnelsPage } from "./FunnelsPage";
import { rememberFunnelDraft } from "./funnelDraft";

vi.mock("@tanstack/react-router", () => ({ useParams: () => ({ projectId: "p1" }) }));
vi.mock("./AnalysisTabs", () => ({ AnalysisTabs: () => null }));
vi.mock("@/features/filters/AnalysisContextBar", () => ({ useAnalysisContext: () => null }));
vi.mock("@/lib/api/projects", () => ({
  listOrganizations: async () => ({ organizations: [{ id: "org1" }] }),
  listProjects: async () => ({ projects: [{ id: "p1" }] }),
}));
vi.mock("@/lib/api/analytics", () => ({
  getBehaviorAnalytics: async () => ({
    catalog: [{ kind: "page_view", name: "page_view", metric: { events: 10 } }],
    properties: [],
  }),
  queryFunnel: vi.fn(),
}));
const funnelResult: Awaited<ReturnType<typeof queryFunnel>> = {
  from: "2026-11-04T00:00:00Z",
  to: "2026-11-05T00:00:00Z",
  dimension: "country",
  windowSeconds: 3600,
  identity: "session_id",
  approximate: true,
  steps: [
    {
      index: 1,
      kind: "page_view",
      name: "page_view",
      sessions: 10,
      conversionFromFirst: 1,
      conversionFromPrevious: null,
    },
    {
      index: 2,
      kind: "click",
      name: "click",
      sessions: 0,
      conversionFromFirst: 0,
      conversionFromPrevious: 0,
    },
  ],
  breakdown: [],
  samples: [],
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(queryFunnel).mockResolvedValue(funnelResult);
});
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FunnelsPage />
    </QueryClientProvider>,
  );
}
describe("funnel interpretation", () => {
  it("restores the last run and a distinct edited draft after investigation", async () => {
    const applied = {
      dimension: "country" as const,
      windowSeconds: 3600 as const,
      steps: [
        { kind: "page_view" as const, name: "page_view" },
        { kind: "click" as const, name: "click" },
      ],
    };
    rememberFunnelDraft(
      "p1",
      { ...applied, steps: [applied.steps[0], { kind: "custom", name: "purchase" }] },
      applied,
    );
    const view = renderPage();
    await view.findByRole("region", { name: "转化结果" });
    expect(view.getByText(/下方仍是上次运行结果/)).toBeTruthy();
    expect(view.getByRole("combobox", { name: "漏斗步骤 2" }).textContent).toContain("purchase");
    expect(vi.mocked(queryFunnel).mock.calls[0][0].steps).toEqual(applied.steps);
    fireEvent.click(view.getByRole("button", { name: "运行漏斗" }));
    await waitFor(() =>
      expect(vi.mocked(queryFunnel).mock.calls.at(-1)?.[0].steps[1].name).toBe("purchase"),
    );
  });
  it("waits for an explicit run and explains unobserved steps before interpreting zero conversion", async () => {
    const view = renderPage();
    await waitFor(() => expect(view.getByText(/当前时间与环境下未观测到/)).toBeTruthy());
    expect(queryFunnel).not.toHaveBeenCalled();
    expect(view.queryByRole("region", { name: "转化结果" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "运行漏斗" }));
    const results = await view.findByRole("region", { name: "转化结果" });
    expect(within(results).getByText("0.0%")).toBeTruthy();
    expect(
      (results.querySelectorAll(".funnel-result-track span")[1] as HTMLElement).style.width,
    ).toBe("0%");
    expect(view.getByText(/不能单独说明业务流失/)).toBeTruthy();
  });

  it("does not give an empty starting cohort a 100% conversion rate", async () => {
    vi.mocked(queryFunnel).mockResolvedValue({
      ...funnelResult,
      steps: funnelResult.steps.map((step) => ({
        ...step,
        sessions: 0,
        conversionFromFirst: null,
        conversionFromPrevious: null,
      })),
    });
    const view = renderPage();
    fireEvent.click(await view.findByRole("button", { name: "运行漏斗" }));
    const results = await view.findByRole("region", { name: "转化结果" });
    expect(results.textContent).not.toContain("100.0%");
  });
});
