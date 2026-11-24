// @vitest-environment jsdom
import { useState } from "react";
import DevDataNotice from "./DevDataNotice";
import { DevDataDialogContext, type DevDataDialogRequest } from "./devDataDialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/api/projects";
import { generateDevData, getDevDataPresets } from "@/lib/api/devData";
import { getSessionTimelinePage } from "@/lib/api/sessions";
import { DevDataForm, DevDataQuickEntry } from "./DevDataPage";

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
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-22T02:00:00Z").getTime());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
  vi.unstubAllEnvs();
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
        (view.getByRole("button", { name: "添加测试数据" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "添加测试数据" }));
    await view.findByText("测试数据已可查看");
    expect(generateDevData).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        environment: "test",
        from: new Date(result.from).toISOString(),
        to: new Date(result.to).toISOString(),
        sessions: 300,
        users: { ids: [], signedIn: 0.45 },
      }),
    );
    expect(vi.mocked(generateDevData).mock.calls[0][1]).not.toHaveProperty("dsn");
    expect(view.client.getQueryState(["overview", "p1"])?.isInvalidated).toBe(true);
    expect(view.getByRole("link", { name: "查看仪表盘" }).getAttribute("href")).toContain(
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
    expect((view.getByRole("button", { name: "添加测试数据" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(generateDevData).not.toHaveBeenCalled();
  });
  it("shows the real failure instead of hiding it behind a generic message", async () => {
    vi.mocked(generateDevData).mockRejectedValue(new Error("请选择当前项目已配置的环境。"));
    const view = mount();
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "添加测试数据" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "添加测试数据" }));
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
        (view.getByRole("button", { name: "添加测试数据" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "添加测试数据" }));
    await view.findByText("存储硬熔断");
    expect(view.queryByText("测试数据已可查看")).toBeNull();
    expect(getSessionTimelinePage).not.toHaveBeenCalled();
  });
});

describe("page-level quick entry", () => {
  it("opens from a custom trigger with the given preset for a single project", async () => {
    vi.mocked(getDevDataPresets).mockResolvedValue({
      presets: [{ id: "web-vitals", name: "Vitals", description: "Vitals" }],
      scenario: { seed: 1, environment: "test", sessions: 10, baseUrl: "https://shop.example.com" },
    });
    vi.mocked(generateDevData).mockResolvedValue(result);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DevDataQuickEntry
          projects={[project]}
          project={project}
          preset="web-vitals"
          trigger={<button type="button">造性能数据</button>}
        />
      </QueryClientProvider>,
    );
    // The custom trigger replaces the floating button.
    expect(view.queryByRole("button", { name: "造数据" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "造性能数据" }));
    await waitFor(() => expect(getDevDataPresets).toHaveBeenCalledWith("p1", "web-vitals", 60));
    // One project needs no project picker.
    expect(view.queryByText("目标项目")).toBeNull();
    const submit = await view.findByRole("button", { name: "添加测试数据" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(generateDevData).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ preset: "web-vitals", from: expect.any(String) }),
      ),
    );
  });
});

describe("SDK setup development notice", () => {
  it("handles a request present at mount without reopening a dismissed dialog", async () => {
    vi.mocked(getDevDataPresets).mockResolvedValue({
      presets: [{ id: "storefront", name: "Store", description: "Mixed events" }],
      scenario: { seed: 1, environment: "test", sessions: 10, baseUrl: "https://shop.example.com" },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const request = { project, sequence: 1 };
    const entry = (
      <QueryClientProvider client={client}>
        <DevDataQuickEntry projects={[project]} request={request} />
      </QueryClientProvider>
    );
    const view = render(entry);
    await view.findByRole("dialog");
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    view.rerender(entry);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("opens the global dialog for the requested project and survives the notice unmounting", async () => {
    vi.mocked(getDevDataPresets).mockResolvedValue({
      presets: [{ id: "storefront", name: "Store", description: "Mixed events" }],
      scenario: { seed: 1, environment: "test", sessions: 10, baseUrl: "https://shop.example.com" },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const otherProject = { ...project, id: "other", name: "Other project" };
    function Harness({ showNotice }: { showNotice: boolean }) {
      const [request, setRequest] = useState<DevDataDialogRequest>();
      return (
        <QueryClientProvider client={client}>
          <DevDataDialogContext.Provider
            value={(selected) =>
              setRequest((current) => ({
                project: selected,
                sequence: (current?.sequence ?? 0) + 1,
              }))
            }
          >
            {showNotice ? <DevDataNotice project={project} /> : null}
            <DevDataQuickEntry projects={[otherProject]} project={otherProject} request={request} />
          </DevDataDialogContext.Provider>
        </QueryClientProvider>
      );
    }
    const view = render(<Harness showNotice />);
    fireEvent.click(view.getByRole("button", { name: "添加测试数据" }));
    await view.findByRole("dialog");
    await waitFor(() => expect(getDevDataPresets).toHaveBeenCalledWith("p1", "storefront", 60));
    expect(generateDevData).not.toHaveBeenCalled();
    view.rerender(<Harness showNotice={false} />);
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(view.getAllByRole("button", { name: "添加测试数据" })).toHaveLength(1);
  });

  it("does not render the notice outside development", () => {
    vi.stubEnv("DEV", false);
    const view = render(
      <DevDataDialogContext.Provider value={vi.fn()}>
        <DevDataNotice project={project} />
      </DevDataDialogContext.Provider>,
    );
    expect(view.container.textContent).toBe("");
  });
});

describe("simplified test-data flow", () => {
  it("blocks an expired global range and offers an explicit recent-hour recovery", async () => {
    vi.mocked(Date.now).mockReturnValue(new Date("2026-11-17T02:00:00Z").getTime());
    const view = mount();
    await view.findByText("当前范围超出最近 30 天，无法添加测试数据。");
    expect((view.getByRole("button", { name: "添加测试数据" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(view.getByRole("button", { name: "使用最近 1 小时" }));
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "添加测试数据" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "添加测试数据" }));
    await waitFor(() =>
      expect(generateDevData).toHaveBeenCalledWith("p1", expect.objectContaining({ minutes: 60 })),
    );
    expect(vi.mocked(generateDevData).mock.calls[0][1]).not.toHaveProperty("from");
  });

  it("keeps a pending job when the dialog is closed, without issuing a second write", async () => {
    vi.mocked(getDevDataPresets).mockResolvedValue({
      presets: [{ id: "logs", name: "Logs", description: "Logs" }],
      scenario: { seed: 1, environment: "test", sessions: 10, baseUrl: "https://shop.example.com" },
    });
    let resolve!: (value: typeof result) => void;
    vi.mocked(generateDevData).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    vi.mocked(getSessionTimelinePage).mockResolvedValue(
      {} as Awaited<ReturnType<typeof getSessionTimelinePage>>,
    );
    window.history.replaceState({}, "", "/projects/p1/logs?q=old-filter");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DevDataQuickEntry projects={[project]} project={project} />
      </QueryClientProvider>,
    );
    fireEvent.click(view.getByRole("button", { name: "造数据" }));
    await waitFor(() => expect(getDevDataPresets).toHaveBeenCalledWith("p1", "logs", 60));
    const submit = within(view.getByRole("dialog")).getByRole("button", { name: "添加测试数据" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await view.findByText("正在生成并写入测试数据");
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "造数据" }));
    await view.findByText("正在生成并写入测试数据");
    expect(generateDevData).toHaveBeenCalledTimes(1);
    resolve(result);
    await view.findByText("测试数据已可查看");
    const href = view.getByRole("link", { name: "查看日志" }).getAttribute("href")!;
    expect(href).toContain("/projects/p1/logs?from=");
    expect(href).toContain("environment=test");
    expect(href).not.toContain("old-filter");
    expect(view.getByRole("link", { name: "查看 SDK 接入指引" }).getAttribute("href")).toBe(
      "/projects/p1/onboarding",
    );
    window.history.replaceState({}, "", "/");
  });
});
