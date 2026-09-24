// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

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
  const slider = screen.getByLabelText("页面、性能与自定义事件采样率") as HTMLInputElement;
  const save = screen.getByRole("button", { name: "保存采样配置" }) as HTMLButtonElement;
  expect(screen.getByText("预估不可用")).toBeTruthy();
  fireEvent.change(slider, { target: { value: "40" } });
  fireEvent.click(save);
  await waitFor(() => expect(client.getQueryData(["project", project.id])).toEqual(saved));
  expect(client.getQueryData(["projects", project.organizationId])).toEqual({ projects: [saved] });
  expect(save.disabled).toBe(true);
  expect(updateProject).toHaveBeenCalledWith(project.id, {
    eventSampleRate: 0.4,
    apiSampleRate: 0.2,
    errorSampleRate: 1,
  });
  fireEvent.change(slider, { target: { value: "30" } });
  expect(screen.queryByText("已保存并开始分发")).toBeNull();
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("已回滚"));
  expect(slider.value).toBe("40");
  expect(save.disabled).toBe(true);
});

it("keeps sampling read-only for members even when usage is unavailable", () => {
  renderForm({ ...project, role: "member" });
  expect((screen.getByRole("button", { name: "保存采样配置" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  for (const slider of screen.getAllByRole("slider")) {
    expect((slider as HTMLInputElement).disabled).toBe(true);
  }
  expect(updateProject).not.toHaveBeenCalled();
});
