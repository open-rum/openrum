// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoragePressure } from "@/lib/api/storagePressure";
import { StoragePressureBanner } from "./StoragePressureBanner";

const base: StoragePressure = {
  mode: "normal",
  level: "normal",
  usedPercent: 80,
  automaticSamplingActive: false,
  automaticSamplingRate: null,
  ingestBlocked: false,
  observedAt: "2026-09-15T10:00:00Z",
};

describe("StoragePressureBanner", () => {
  it("stays hidden while storage is normal", () => {
    const view = render(<StoragePressureBanner pressure={base} />);
    expect(view.container.innerHTML).toBe("");
  });

  it("explains automatic sampling and hard-stop states", () => {
    const view = render(
      <StoragePressureBanner
        pressure={{
          ...base,
          mode: "sampling",
          level: "warning",
          usedPercent: 91,
          automaticSamplingActive: true,
          automaticSamplingRate: 0.1,
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("临时采样上限为 10%");

    view.rerender(
      <StoragePressureBanner
        pressure={{
          ...base,
          mode: "blocked",
          level: "critical",
          usedPercent: 96,
          automaticSamplingActive: true,
          automaticSamplingRate: 0,
          ingestBlocked: true,
        }}
        canRecover
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("数据接入已暂停");
    expect(screen.getByRole("link", { name: "立即清理旧数据" }).getAttribute("href")).toContain(
      "/settings/instance/retention?recovery=1",
    );
  });
});
