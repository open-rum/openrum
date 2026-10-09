// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetailPage } from "./IssueDetailPage";
import { getEvent, getIssueDetail, getIssueEvents, updateIssue } from "@/lib/api/issues";

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ projectId: "project-1", fingerprint: "v1:checkout" }),
}));
vi.mock("./IssueTrend", () => ({
  IssueTrend: ({ totals, tags }: { totals: { events: number }; tags?: React.ReactNode }) => (
    <div>
      <span>{totals.events}</span>
      {tags}
    </div>
  ),
}));
vi.mock("@/lib/api/projects", () => ({
  listOrganizations: async () => ({ organizations: [{ id: "org-1" }] }),
  listProjects: async () => ({ projects: [{ id: "project-1", role: "owner" }] }),
  listMembers: async () => ({ members: [] }),
}));
vi.mock("@/lib/api/issues", async (original) => ({
  ...(await original<typeof import("@/lib/api/issues")>()),
  getIssueDetail: vi.fn(),
  getIssueEvents: vi.fn(),
  getEvent: vi.fn(),
  updateIssue: vi.fn(),
}));
vi.mock("./EventContext", async (original) => ({
  ...(await original<typeof import("./EventContext")>()),
  EventBreadcrumbs: () => <div>Breadcrumbs</div>,
}));
const detail = {
  issue: {
    fingerprint: "v1:checkout",
    fingerprintVersion: 1,
    title: "Checkout failed",
    errorType: "TypeError",
    events: 42,
    users: 18,
    sessions: 20,
    firstSeenAt: "2026-09-11T10:00:00Z",
    lastSeenAt: "2026-09-11T11:00:00Z",
    status: "unresolved" as const,
    assigneeUserId: null,
    resolvedInReleaseId: null,
  },
  trend: [],
  facets: { environments: [], releases: [], browsers: [], deviceTypes: [], countries: [] },
};
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(
    {},
    "",
    "/projects/project-1/issues/v1%3Acheckout?environment=production&browser=Safari&cursor=second&from=2026-09-11T00:00:00Z&to=2026-09-12T00:00:00Z",
  );
  vi.mocked(getIssueDetail).mockResolvedValue(detail);
  vi.mocked(getIssueEvents).mockResolvedValue({ events: [] });
});
afterEach(cleanup);
function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <IssueDetailPage />
    </QueryClientProvider>,
  );
}

describe("issue investigation context", () => {
  it("retains project and filters in the return link", async () => {
    const view = renderDetail();
    await waitFor(() => expect(view.getByText("Checkout failed")).toBeTruthy());
    const href = view.getByText("返回问题列表").getAttribute("href")!;
    expect(href).toContain("/projects/project-1/issues?");
    expect(href).toContain("cursor=second");
    expect(href).toContain("browser=Safari");
  });

  it("refetches detail and event samples when the shared environment changes", async () => {
    const view = renderDetail();
    await waitFor(() => expect(view.getByText("Checkout failed")).toBeTruthy());
    act(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("environment", "canary");
      window.history.pushState({}, "", url);
      window.dispatchEvent(new Event("openrum:urlchange"));
    });
    await waitFor(() =>
      expect(vi.mocked(getIssueDetail).mock.lastCall?.[0].environment).toBe("canary"),
    );
    await waitFor(() =>
      expect(vi.mocked(getIssueEvents).mock.lastCall?.[0].environment).toBe("canary"),
    );
    expect(view.getByText("返回问题列表").getAttribute("href")).toContain("environment=canary");
  });

  it("rolls back a failed status mutation and allows retry", async () => {
    vi.mocked(updateIssue).mockRejectedValue(new Error("unavailable"));
    const view = renderDetail();
    await waitFor(() => expect(view.getByText("标记解决")).toBeTruthy());
    fireEvent.click(view.getByText("标记解决"));
    await waitFor(() => expect(view.getByText("更新失败，已恢复原状态")).toBeTruthy());
    expect(view.getByText("待处理")).toBeTruthy();
    expect((view.getByText("标记解决") as HTMLButtonElement).disabled).toBe(false);
  });

  it("filters the investigation from a tag value and shows it as a removable token", async () => {
    vi.mocked(getIssueDetail).mockResolvedValue({
      ...detail,
      facets: {
        ...detail.facets,
        releases: [{ value: "web@1.2.0", events: 30, users: 12 }],
      },
    });
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${window.location.search}&timePreset=7d`,
    );
    const view = renderDetail();
    const preview = await waitFor(() => view.getByRole("list", { name: "版本分布" }));
    const value = within(preview).getByRole("button", { name: /web@1\.2\.0/ });
    expect(value.textContent).toContain("71%");
    fireEvent.click(value);
    await waitFor(() =>
      expect(vi.mocked(getIssueDetail).mock.lastCall?.[0].release).toBe("web@1.2.0"),
    );
    const url = new URL(window.location.href);
    expect(url.searchParams.get("release")).toBe("web@1.2.0");
    expect(url.searchParams.get("timePreset")).toBe("7d");
    fireEvent.click(await waitFor(() => view.getByLabelText("移除筛选：版本")));
    await waitFor(() =>
      expect(vi.mocked(getIssueDetail).mock.lastCall?.[0].release).toBeUndefined(),
    );
  });

  it("steps through events from the event navigation bar", async () => {
    const sample = (eventId: string, timestamp: string) => ({
      projectId: "project-1",
      eventId,
      timestamp,
      receivedAt: timestamp,
      environment: "production",
      release: "web@1.2.0",
      sessionId: "s1",
      pageId: "p1",
      pageUrl: "https://shop.example/checkout",
      route: "/checkout",
      browser: "Chrome",
      errorType: "TypeError",
      errorMessage: "Checkout failed",
      fingerprint: "v1:checkout",
      fingerprintVersion: 1,
      handled: false,
      breadcrumbs: [],
      ingestFlags: [],
      availability: { stack: false, breadcrumbs: false, visitor: false, release: true },
      relatedApis: [],
    });
    const events = [
      sample("newest", "2026-09-11T11:00:00Z"),
      sample("older", "2026-09-11T10:00:00Z"),
    ];
    vi.mocked(getIssueEvents).mockResolvedValue({ events });
    vi.mocked(getEvent).mockImplementation(async (id) =>
      events.find((item) => item.eventId === id)!,
    );
    const view = renderDetail();
    await waitFor(() => expect(view.getByText(/本页第 1 \/ 2 个/)).toBeTruthy());
    expect(view.getByText(/最新事件/)).toBeTruthy();
    expect((view.getByLabelText("较新的事件") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByLabelText("较早的事件"));
    await waitFor(() => expect(view.getByText(/本页第 2 \/ 2 个/)).toBeTruthy());
    expect(vi.mocked(getEvent).mock.lastCall?.[0]).toBe("older");
    fireEvent.click(view.getByRole("button", { name: "最新" }));
    await waitFor(() => expect(view.getByText(/本页第 1 \/ 2 个/)).toBeTruthy());
    expect(view.getByRole("heading", { name: "堆栈追踪" })).toBeTruthy();
  });

  it("reports sample failure separately from aggregate data", async () => {
    vi.mocked(getIssueEvents).mockRejectedValue(new Error("unavailable"));
    const view = renderDetail();
    await waitFor(() => expect(view.getByText("无法加载事件样本")).toBeTruthy());
    expect(view.getByText("Checkout failed")).toBeTruthy();
    expect(view.getByText("42")).toBeTruthy();
  });
});
