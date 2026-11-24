// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, listOrganizations } from "@/lib/api/projects";
import { ProjectCreatePage } from "./ProjectCreatePage";

vi.mock("@/lib/api/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/projects")>()),
  listOrganizations: vi.fn(),
  createProject: vi.fn(),
}));
vi.mock("@/lib/telemetry/productEvents", () => ({ recordProductEvent: vi.fn() }));

const org = {
  id: "org",
  name: "测试组织",
  slug: "test",
  role: "owner" as const,
  createdAt: "",
  updatedAt: "",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const routeTree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: "/projects/new",
      component: ProjectCreatePage,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/projects/$projectId/onboarding",
      component: () => <h1>SDK 接入</h1>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/projects",
      component: () => <h1>项目列表</h1>,
    }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/projects/new"] }),
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listOrganizations).mockResolvedValue({ organizations: [org] });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("project creation", () => {
  it("requires confirmation of a pasted URL correction, preserves defaults, then opens onboarding", async () => {
    vi.mocked(createProject).mockResolvedValue({ id: "created" } as Awaited<
      ReturnType<typeof createProject>
    >);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("测试组织");
    expect(screen.queryByRole("combobox", { name: "所属组织" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "项目名称" }), "商城");
    const sites = screen.getByRole("textbox", { name: "允许上报的站点" });
    expect((sites as HTMLTextAreaElement).value).toBe("http://localhost:4173");
    await user.clear(sites);
    await user.type(sites, "https://example.com/products");
    await user.click(screen.getByRole("button", { name: "创建并接入" }));
    expect(createProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "改为 https://example.com" }));
    expect((sites as HTMLTextAreaElement).value).toBe("https://example.com");
    await user.click(screen.getByRole("button", { name: "创建并接入" }));
    expect(createProject).toHaveBeenCalledWith("org", {
      name: "商城",
      sdkPlatform: "javascript",
      allowedOrigins: ["https://example.com"],
      retentionDays: 14,
      eventSampleRate: 1,
      apiSampleRate: 0.2,
      errorSampleRate: 1,
    });
    await screen.findByRole("heading", { name: "SDK 接入" });
  });

  it("submits the prefilled default allowed origin without extra edits", async () => {
    vi.mocked(createProject).mockResolvedValue({ id: "created" } as Awaited<
      ReturnType<typeof createProject>
    >);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("测试组织");
    await user.type(screen.getByRole("textbox", { name: "项目名称" }), "本地示例");
    await user.click(screen.getByRole("button", { name: "创建并接入" }));
    expect(createProject).toHaveBeenCalledWith("org", {
      name: "本地示例",
      sdkPlatform: "javascript",
      allowedOrigins: ["http://localhost:4173"],
      retentionDays: 14,
      eventSampleRate: 1,
      apiSampleRate: 0.2,
      errorSampleRate: 1,
    });
    await screen.findByRole("heading", { name: "SDK 接入" });
  });

  it("lets a member select another organization they can manage", async () => {
    vi.mocked(listOrganizations).mockResolvedValue({
      organizations: [
        { ...org, role: "member" },
        { ...org, id: "other", name: "其他组织" },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    const select = await screen.findByRole("combobox", { name: "所属组织" });
    expect((screen.getByRole("button", { name: "创建并接入" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.selectOptions(select, "other");
    expect((screen.getByRole("button", { name: "创建并接入" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("does not show a new-organization form when organization loading fails", async () => {
    vi.mocked(listOrganizations).mockRejectedValue(new Error("offline"));
    renderPage();
    await screen.findByText("组织加载失败，请重试。");
    expect(screen.queryByRole("textbox", { name: "组织名称" })).toBeNull();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("returns to the list on cancel without creating a project", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("测试组织");
    await user.click(screen.getByRole("link", { name: "取消" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "项目列表" })).toBeTruthy());
    expect(createProject).not.toHaveBeenCalled();
  });
});
