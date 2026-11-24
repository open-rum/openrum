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
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOnboardingKey, listProjectKeys, rotateProjectKey } from "@/lib/api/client";
import { OnboardingPage } from "./OnboardingPage";

vi.mock("@/lib/api/client", async (original) => ({
  ...(await original<typeof import("@/lib/api/client")>()),
  createOnboardingKey: vi.fn(),
  listProjectKeys: vi.fn(),
  rotateProjectKey: vi.fn(),
  getConnectionStatus: vi.fn().mockResolvedValue({ keyConfigured: true }),
}));
vi.mock("@/lib/telemetry/productEvents", () => ({ recordProductEvent: vi.fn() }));
const dsn = "https://orr_pk_test@rum.example.com/ingest/v1/envelope";
const defaultKey = { id: "key", isDefault: true, dsn, revokedAt: null };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage(keys: object[], role = "owner") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["organizations"], { organizations: [{ id: "org" }] });
  client.setQueryData(["project", "project"], {
    id: "project",
    role,
    sdkPlatform: "react",
    environment: "production",
  });
  client.setQueryData(["project-keys", "project"], { keys });
  client.setQueryData(["connection-status", "project"], {
    keyConfigured: true,
    lastEventReceivedAt: null,
    lastEventQueryableAt: null,
  });
  const root = createRootRoute({ component: Outlet });
  const routeTree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: "/projects/$projectId/onboarding",
      component: OnboardingPage,
    }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/projects/project/onboarding"] }),
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("simplified onboarding", () => {
  it("shows the DSN inside the SDK configuration without duplicate DSN or progress sections", async () => {
    const view = renderPage([defaultKey]);
    await screen.findByText(
      (_, element) =>
        element?.tagName === "CODE" && Boolean(element.textContent?.includes(`dsn: "${dsn}"`)),
    );
    expect(view.container.querySelectorAll("pre code")).toHaveLength(2);
    expect(screen.queryByText("客户端 DSN", { exact: true })).toBeNull();
    expect(screen.queryByText("接入验证进度 · 历史成功记录")).toBeNull();
    expect(screen.queryByRole("list", { name: "四阶段接入进度" })).toBeNull();
    expect(screen.getByRole("button", { name: "复制配置" })).toBeTruthy();
  });

  it.each([false, true])(
    "retains key generation or legacy upgrade inside SDK configuration (legacy: %s)",
    async (legacy) => {
      vi.mocked(listProjectKeys).mockResolvedValue({ keys: [defaultKey] } as Awaited<
        ReturnType<typeof listProjectKeys>
      >);
      const user = userEvent.setup();
      renderPage(legacy ? [{ ...defaultKey, dsn: undefined }] : []);
      await user.click(
        await screen.findByRole("button", { name: legacy ? "升级默认 DSN" : "生成默认 DSN" }),
      );
      await waitFor(() =>
        expect(legacy ? rotateProjectKey : createOnboardingKey).toHaveBeenCalled(),
      );
      if (legacy) expect(rotateProjectKey).toHaveBeenCalledWith("project", "key");
      else expect(createOnboardingKey).toHaveBeenCalledWith("project");
      await screen.findByText(
        (_, element) =>
          element?.tagName === "CODE" && Boolean(element.textContent?.includes(`dsn: "${dsn}"`)),
      );
      expect(screen.queryByRole("button", { name: /默认 DSN/ })).toBeNull();
    },
  );

  it("keeps permission guidance for members without offering key creation", async () => {
    renderPage([], "member");
    await screen.findByText("请联系 Owner 或 Admin 获取默认 DSN，并填入下方 SDK 配置。");
    expect(screen.queryByRole("button", { name: /默认 DSN/ })).toBeNull();
  });
});
