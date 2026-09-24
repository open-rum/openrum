// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/api/projects";
import { generateDevData, getDevDataPresets } from "@/lib/api/devData";
import { getSessionTimelinePage } from "@/lib/api/sessions";
import { DevDataForm } from "./DevDataPage";

vi.mock("@/lib/api/devData", () => ({
  devDataWindows: [{ label: "最近 1 小时", minutes: 60 }],
  getDevDataPresets: vi.fn(),
  generateDevData: vi.fn(),
}));
vi.mock("@/lib/api/sessions", () => ({ getSessionTimelinePage: vi.fn() }));
vi.mock("@/features/filters/AnalysisContextBar", () => ({
  useAnalysisContext: () => ({
    projectId: "p1",
    environment: "test",
    from: new Date("2026-09-22T00:00:00Z"),
    to: new Date("2026-09-22T01:00:00Z"),
  }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
});
const project = {
  id: "p1",
  name: "Store",
  role: "admin",
  status: "active",
  environment: "production",
  environments: ["production", "test"],
} as Project;
function mount(overrides: Partial<Project> = {}) {
  vi.mocked(getDevDataPresets).mockResolvedValue({
    presets: [{ id: "storefront", name: "Store", description: "Mixed events" }],
    scenario: {
      seed: 1,
      environment: "production",
      sessions: 10,
      baseUrl: "https://shop.example.com",
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["overview", "p1"], {});
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <DevDataForm project={{ ...project, ...overrides }} />
      </QueryClientProvider>,
    ),
  };
}
const result = {
  summary: { sessions: 100, envelopes: 10, events: 200, byType: { page_view: 100, api: 100 } },
  accepted: 200,
  rejected: 0,
  envelopes: 10,
  failed: 0,
  unsent: 0,
  elapsedMs: 400,
  message: "等待入库",
  from: "2026-09-22T00:00:00Z",
  to: "2026-09-22T01:00:00Z",
  environment: "test",
  baseUrl: "https://shop.example.com",
  probeEventId: "e1",
  probeSessionId: "s1",
  probeAt: "2026-09-22T00:01:00Z",
};

describe("development generator", () => {
  it("uses current scope without cached DSN, verifies a sample and invalidates dashboard", async () => {
    vi.mocked(generateDevData).mockResolvedValue(result);
    vi.mocked(getSessionTimelinePage).mockResolvedValue(
      {} as Awaited<ReturnType<typeof getSessionTimelinePage>>,
    );
    localStorage.setItem("openrum.devdata.dsn", "stale-other-project-key");
    const view = mount();
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "生成测试数据" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "生成测试数据" }));
    await view.findByText("已确认样本入库，页面数据已刷新");
    expect(generateDevData).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        environment: "test",
        from: new Date(result.from).toISOString(),
        to: new Date(result.to).toISOString(),
        sessions: 100,
      }),
    );
    expect(vi.mocked(generateDevData).mock.calls[0][1]).not.toHaveProperty("dsn");
    expect(view.client.getQueryState(["overview", "p1"])?.isInvalidated).toBe(true);
    expect(view.getByRole("link", { name: "按生成范围查看大盘" }).getAttribute("href")).toContain(
      "environment=test",
    );
    expect(getSessionTimelinePage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", limit: 1 }),
      expect.any(AbortSignal),
    );
  });
  it("prevents writes to a disabled project", async () => {
    const view = mount({ status: "disabled" });
    await view.findByText("项目已停止，请先在项目设置启用。");
    expect((view.getByRole("button", { name: "生成测试数据" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(generateDevData).not.toHaveBeenCalled();
  });
  it("shows the real failure instead of hiding it behind a generic message", async () => {
    vi.mocked(generateDevData).mockRejectedValue(new Error("请选择当前项目已配置的环境。"));
    const view = mount();
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "生成测试数据" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "生成测试数据" }));
    await view.findByText(/请选择当前项目已配置的环境/);
    expect(generateDevData).toHaveBeenCalledTimes(1);
  });
  it("does not claim queryability when ingest drops the batch", async () => {
    vi.mocked(generateDevData).mockResolvedValue({
      ...result,
      accepted: 0,
      failed: 1,
      unsent: 9,
      probeEventId: undefined,
      probeSessionId: undefined,
      lastError: "存储硬熔断",
    });
    const view = mount();
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "生成测试数据" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "生成测试数据" }));
    await view.findByText("存储硬熔断");
    expect(view.queryByText("已确认样本入库，页面数据已刷新")).toBeNull();
    expect(getSessionTimelinePage).not.toHaveBeenCalled();
  });
});
