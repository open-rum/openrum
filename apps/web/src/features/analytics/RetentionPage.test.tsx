// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRetention } from "@/lib/api/analytics";
import { RetentionPage } from "./RetentionPage";

vi.mock("@tanstack/react-router", () => ({ useParams: () => ({ projectId: "p1" }) }));
vi.mock("./AnalysisTabs", () => ({ AnalysisTabs: () => null }));
vi.mock("@/features/filters/AnalysisContextBar", () => ({ useAnalysisContext: () => context }));
vi.mock("@/lib/api/projects", () => ({
  listOrganizations: async () => ({ organizations: [{ id: "org1" }] }),
  listProjects: async () => ({ projects: [{ id: "p1" }] }),
}));
vi.mock("@/lib/api/analytics", () => ({ getRetention: vi.fn() }));
const context = { projectId: "p1", from: new Date("2026-11-04T00:00:00Z"), to: new Date("2026-11-05T00:00:00Z"), environment: "production", update: vi.fn() };
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  context.from = new Date("2026-11-04T00:00:00Z");
  vi.mocked(getRetention).mockImplementation(async (input) => ({ from: input.from.toISOString(), to: input.to.toISOString(), weeks: input.weeks, identity: "anonymous_user_id", approximate: true, definition: "", cohorts: [] }));
});
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><RetentionPage /></QueryClientProvider>);
}
describe("weekly retention range", () => {
  it("offers 28 days without silently changing the shared range or environment", async () => {
    const view = renderPage();
    const button = await view.findByRole("button", { name: "查看截至所选时间的 28 天" });
    expect(context.update).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(context.update).toHaveBeenCalledWith({ from: new Date("2026-10-08T00:00:00Z"), to: context.to });
    await waitFor(() => expect(getRetention).toHaveBeenCalled());
    expect(vi.mocked(getRetention).mock.calls[0][0].environment).toBe("production");
  });
  it("does not send a 30-day range to the four-week bounded query", async () => {
    context.from = new Date("2026-10-06T00:00:00Z");
    const view = renderPage();
    await waitFor(() => expect(getRetention).toHaveBeenCalled());
    expect(vi.mocked(getRetention).mock.calls[0][0].weeks).toBe(8);
    expect(view.queryByRole("button", { name: "查看截至所选时间的 28 天" })).toBeNull();
  });
});
