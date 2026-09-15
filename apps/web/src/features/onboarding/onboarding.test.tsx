// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionStatus } from "./ConnectionStatus";
import { rejectGuidance } from "./guidance";
import { InstallSnippet } from "./InstallSnippet";

describe("onboarding states", () => {
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
      />,
    );
    expect(view.container.textContent).toContain(
      'dsn: "https://orr_pk_test@rum.example.com/ingest/v1/envelope"',
    );
    expect(view.container.textContent).not.toContain("writeKey:");
    expect(view.container.textContent).not.toContain("endpoint:");
  });
});
