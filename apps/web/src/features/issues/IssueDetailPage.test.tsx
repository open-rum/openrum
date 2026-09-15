// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetailPage } from "./IssueDetailPage";
import { getIssueDetail, getIssueEvents, updateIssue } from "@/lib/api/issues";

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ projectId: "project-1", fingerprint: "v1:checkout" }),
}));
vi.mock("./IssueTrend", () => ({ IssueTrend: () => <div>Trend</div> }));
vi.mock("@/lib/api/projects", () => ({
  listOrganizations: async () => ({ organizations: [{ id: "org-1" }] }),
  listProjects: async () => ({ projects: [{ id: "project-1", role: "owner" }] }),
  listMembers: async () => ({ members: [] }),
}));
vi.mock("@/lib/api/issues", async (original) => ({
  ...(await original<typeof import("@/lib/api/issues")>()),
  getIssueDetail: vi.fn(),
  getIssueEvents: vi.fn(),
  updateIssue: vi.fn(),
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

  it("reports sample failure separately from aggregate data", async () => {
    vi.mocked(getIssueEvents).mockRejectedValue(new Error("unavailable"));
    const view = renderDetail();
    await waitFor(() => expect(view.getByText("无法加载事件样本")).toBeTruthy());
    expect(view.getByText("Checkout failed")).toBeTruthy();
    expect(view.getByText("42")).toBeTruthy();
  });
});
