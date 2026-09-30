// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { updateProject, type Project } from "@/lib/api/projects";
import { SamplingForm } from "./SamplingForm";

vi.mock("@/lib/api/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/projects")>()),
  updateProject: vi.fn(),
}));

const project: Project = {
  id: "project",
  organizationId: "org",
  name: "Demo",
  slug: "demo",
  sdkPlatform: "javascript",
  allowedOrigins: [],
  environment: "production",
  environments: ["production"],
  retentionDays: 14,
  eventSampleRate: 1,
  apiSampleRate: 0.2,
  errorSampleRate: 1,
  ingestRateLimit: null,
  defaultIngestRateLimit: 5000,
  overLimitBehavior: "reject",
  status: "active",
  role: "owner",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

function renderForm(input = project) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(["project", project.id], input);
  client.setQueryData(["projects", project.organizationId], { projects: [input] });
  render(
    <QueryClientProvider client={client}>
      <SamplingForm project={input} previewFallback="预估不可用" />
    </QueryClientProvider>,
  );
  return client;
}

it("saves without usage data, updates both caches and rolls back to the latest saved rates", async () => {
  const saved = { ...project, eventSampleRate: 0.4 };
  vi.mocked(updateProject).mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error("offline"));
  const client = renderForm();
  const slider = screen.getByRole("slider", { name: "页面、性能与自定义事件采样率" });
  const save = screen.getByRole("button", { name: "保存采样配置" }) as HTMLButtonElement;
  expect(screen.getByText("预估不可用")).toBeTruthy();
  // Each ArrowDown is one 10% step.
  for (let step = 0; step < 6; step += 1) fireEvent.keyDown(slider, { key: "ArrowDown" });
  expect(slider.getAttribute("aria-valuenow")).toBe("40");
  fireEvent.click(save);
  await waitFor(() => expect(client.getQueryData(["project", project.id])).toEqual(saved));
  expect(client.getQueryData(["projects", project.organizationId])).toEqual({ projects: [saved] });
  expect(save.disabled).toBe(true);
  expect(updateProject).toHaveBeenCalledWith(project.id, {
    eventSampleRate: 0.4,
    apiSampleRate: 0.2,
    errorSampleRate: 1,
  });
  fireEvent.keyDown(slider, { key: "ArrowDown" });
  expect(screen.queryByText("已保存并开始分发")).toBeNull();
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("已回滚"));
  expect(slider.getAttribute("aria-valuenow")).toBe("40");
  expect(save.disabled).toBe(true);
});

it("keeps sampling read-only for members even when usage is unavailable", () => {
  renderForm({ ...project, role: "member" });
  expect((screen.getByRole("button", { name: "保存采样配置" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  for (const slider of screen.getAllByRole("slider")) {
    expect(slider.getAttribute("data-disabled")).toBe("");
    expect(slider.getAttribute("tabindex")).toBeNull();
  }
  expect(updateProject).not.toHaveBeenCalled();
});
