// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPerformance } from "@/lib/api/performance";
import { PerformancePage } from "./PerformancePage";

const route = vi.hoisted(() => ({ projectId: "p1" }));
vi.mock("@tanstack/react-router", () => ({ useParams: () => route }));
vi.mock("@/features/devdata/DevDataPage", () => ({ DevDataQuickEntry: () => null }));
vi.mock("@/lib/api/projects", () => ({
  listOrganizations: async () => ({ organizations: [{ id: "org1" }] }),
  listProjects: async () => ({ projects: [{ id: "p1" }, { id: "p2" }] }),
}));
vi.mock("@/lib/api/performance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/performance")>()),
  getPerformance: vi.fn(async () => ({
    from: "2026-11-04T00:00:00Z",
    to: "2026-11-05T00:00:00Z",
    routes: [],
    trend: [],
  })),
}));
afterEach(() => {
  cleanup();
  route.projectId = "p1";
  vi.clearAllMocks();
});

describe("performance project switching", () => {
  it("reloads the selected project without showing the previous project's empty-state action", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = () => (
      <QueryClientProvider client={client}>
        <PerformancePage />
      </QueryClientProvider>
    );
    const view = render(page());
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "检查性能采集" }).getAttribute("href")).toContain(
        "/p1/",
      ),
    );
    route.projectId = "p2";
    view.rerender(page());
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "检查性能采集" }).getAttribute("href")).toContain(
        "/p2/",
      ),
    );
    expect(vi.mocked(getPerformance).mock.calls.at(-1)?.[0].projectId).toBe("p2");
  });
});
