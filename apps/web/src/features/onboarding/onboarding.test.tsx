// @vitest-environment jsdom

import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionStatus } from "./ConnectionStatus";
import { rejectGuidance } from "./guidance";
import { InstallSnippet } from "./InstallSnippet";
import { ConnectionHealth } from "./ConnectionHealth";

afterEach(cleanup);

describe("onboarding states", () => {
  it("shows later success alongside a historical rejection without declaring total failure", () => {
    const view = render(
      <ConnectionHealth
        status={{
          keyConfigured: true,
          lastSdkSeenAt: "2026-11-04T09:00:00Z",
          lastEventReceivedAt: "2026-11-04T09:00:00Z",
          lastEventQueryableAt: "2026-11-04T09:00:05Z",
          lastRejectReason: "INVALID_EVENT",
          lastRejectAt: "2026-11-03T09:00:00Z",
        }}
      />,
    );
    expect(view.getByText("历史拒收记录 · 此后已成功接收事件")).toBeTruthy();
    expect(view.getByText(/拒收记录不代表全部事件失败/)).toBeTruthy();
    expect(view.getByText(/事件格式不受支持/)).toBeTruthy();
  });
  it("keeps a rejection newer than the last accepted event visible as a current warning", () => {
    const view = render(
      <ConnectionHealth
        status={{
          keyConfigured: true,
          lastSdkSeenAt: null,
          lastEventReceivedAt: "2026-11-03T09:00:00Z",
          lastEventQueryableAt: null,
          lastRejectReason: "INVALID_EVENT",
          lastRejectAt: "2026-11-04T09:00:00Z",
        }}
      />,
    );
    expect(view.getByText("最近检测到事件拒收")).toBeTruthy();
    expect(view.queryByText("历史拒收记录 · 此后已成功接收事件")).toBeNull();
  });
  it("renders all four waiting stages for a first-time project", () => {
    const view = render(
      <ConnectionStatus
        loading={false}
        hasInstallDSN={false}
        status={{
          keyConfigured: false,
          lastSdkSeenAt: null,
          lastEventReceivedAt: null,
          lastEventQueryableAt: null,
          lastRejectReason: null,
          lastRejectAt: null,
        }}
      />,
    );
    expect(view.container.textContent).toContain("1. 客户端 DSN");
    expect(view.container.textContent).toContain("4. 数据可查询");
    expect(view.container.textContent?.match(/等待/g)).toHaveLength(4);
  });

  it("provides an exact invalid-Origin remediation", () => {
    expect(rejectGuidance.ORIGIN_REJECTED.title).toBe("上报 Origin 未被允许");
    expect(rejectGuidance.ORIGIN_REJECTED.action).toContain("Allowed Origins");
    expect(rejectGuidance.ORIGIN_REJECTED.action).toContain("不要填写路径");
  });

  it("shows one DSN instead of separate endpoint and write key options", () => {
    const view = render(
      <InstallSnippet
        dsn="https://orr_pk_test@rum.example.com/ingest/v1/envelope"
        environment="production"
        platform="react"
      />,
    );
    expect(view.container.textContent).toContain(
      'dsn: "https://orr_pk_test@rum.example.com/ingest/v1/envelope"',
    );
    expect(view.container.textContent).not.toContain("writeKey:");
    expect(view.container.textContent).not.toContain("endpoint:");
    expect(view.container.textContent).toContain("安装并初始化 React SDK");
    expect(view.container.textContent).toContain("src/main.tsx");
  });

  it("offers asynchronous and synchronous Instance CDN snippets", async () => {
    const user = userEvent.setup();
    const view = render(
      <InstallSnippet
        dsn="https://orr_pk_test@rum.example.com/ingest/v1/envelope"
        environment="production"
        platform="javascript"
      />,
    );
    const current = within(view.container);
    await user.click(current.getByRole("tab", { name: "CDN 脚本" }));
    const cdnPanel = current.getByRole("tabpanel", { name: "CDN 脚本" });
    expect(cdnPanel.textContent).toContain(
      'script.src = "https://rum.example.com/sdk/browser/0.1.2/openrum.min.js"',
    );
    expect(cdnPanel.textContent).toContain("OpenRUM.init");
    expect(cdnPanel.textContent).toContain("script.onload");

    await user.click(current.getByRole("tab", { name: "同步加载" }));
    expect(cdnPanel.textContent).toContain(
      'src="https://rum.example.com/sdk/browser/0.1.2/openrum.min.js"',
    );
    expect(cdnPanel.textContent).not.toContain("script.onload");
  });
});
