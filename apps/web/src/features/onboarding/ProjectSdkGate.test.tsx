// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionStatus } from "@/lib/api/client";
import ProjectSdkGate from "./ProjectSdkGate";
import { isSdkDataRoute } from "./sdkDataRoute";

afterEach(cleanup);
const status: ConnectionStatus = {
  keyConfigured: true,
  sdkConnected: false,
  lastSdkSeenAt: null,
  lastEventReceivedAt: null,
  lastEventQueryableAt: null,
  lastRejectReason: null,
  lastRejectAt: null,
};
function fixtures() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const [id, sdkPlatform] of [
    ["react-project", "react"],
    ["vue-project", "vue"],
  ]) {
    client.setQueryData(["project", id], {
      id,
      sdkPlatform,
      role: "owner",
      environment: "production",
    });
    client.setQueryData(["project-keys", id], {
      keys: [
        {
          id: "key",
          isDefault: true,
          dsn: `https://orr_pk_${id}@rum.example.com/ingest/v1/envelope`,
        },
      ],
    });
  }
  return client;
}

describe("SDK setup gate", () => {
  it("shows platform-specific instructions without mounting the data view, then automatically reveals it", () => {
    const client = fixtures();
    const mount = vi.fn();
    function DataView() {
      mount();
      return <div>日志数据</div>;
    }
    const page = (data: ConnectionStatus, projectId = "react-project") => (
      <QueryClientProvider client={client}>
        <ProjectSdkGate
          projectId={projectId}
          connection={{ data, isPending: false, isError: false }}
        >
          <DataView />
        </ProjectSdkGate>
      </QueryClientProvider>
    );
    const view = render(page(status));
    expect(screen.getByRole("heading", { name: "您还没有接入 SDK" })).toBeTruthy();
    expect(screen.getByText(/src\/main.tsx/)).toBeTruthy();
    expect(screen.getByText(/为您的 React 应用/)).toBeTruthy();
    expect(mount).not.toHaveBeenCalled();
    view.rerender(page(status, "vue-project"));
    expect(screen.getByRole("heading", { name: "您还没有接入 SDK" })).toBeTruthy();
    expect(view.container.textContent).not.toContain("orr_pk_react-project");
    expect(screen.getByText(/为您的 Vue 应用/)).toBeTruthy();
    view.rerender(page({ ...status, sdkConnected: true }, "vue-project"));
    expect(screen.getByText("日志数据")).toBeTruthy();
    expect(screen.queryByText("安装与配置")).toBeNull();
  });

  it.each([
    { data: { ...status, sdkConnected: true }, isError: false },
    { data: { ...status, sdkConnected: undefined }, isError: false },
    { data: undefined, isError: true },
    { data: status, isError: true },
  ])("does not treat existing, unknown or failed status as never connected: %j", (connection) => {
    render(
      <QueryClientProvider client={fixtures()}>
        <ProjectSdkGate projectId="react-project" connection={{ ...connection, isPending: false }}>
          <div>正常页面</div>
        </ProjectSdkGate>
      </QueryClientProvider>,
    );
    expect(screen.getByText("正常页面")).toBeTruthy();
  });

  it("does not flash the data view before the initial status check", () => {
    render(
      <QueryClientProvider client={fixtures()}>
        <ProjectSdkGate projectId="react-project" connection={{ isPending: true, isError: false }}>
          <div>正常页面</div>
        </ProjectSdkGate>
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("正在检查 SDK 接入状态")).toBeTruthy();
    expect(screen.queryByText("正常页面")).toBeNull();
  });

  it.each([
    "overview",
    "overview/dashboard",
    "analytics",
    "analytics/funnels",
    "issues/issue",
    "logs",
    "performance",
    "events",
    "apis",
    "sessions/session",
  ])("gates the data route %s", (path) => {
    expect(isSdkDataRoute(`/projects/p/${path}`)).toBe(true);
  });
  it.each([
    "/projects",
    "/projects/new",
    "/projects/p/alerts",
    "/projects/p/onboarding",
    "/settings/project/p/general",
    "/usage",
  ])("keeps management route %s available", (path) => {
    expect(isSdkDataRoute(path)).toBe(false);
  });
});
