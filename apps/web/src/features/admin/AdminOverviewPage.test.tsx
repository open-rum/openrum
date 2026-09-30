// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AdminOverview } from "@/lib/api/admin";
import { AdminOverviewPage } from "./AdminOverviewPage";

afterEach(cleanup);

function renderOverview(
  workerStatus: "healthy" | "unhealthy",
  kafkaStatus: "healthy" | "unknown" = "unknown",
) {
  const overview: AdminOverview = {
    version: "test",
    environment: "test",
    deploymentMode: "standalone",
    startedAt: "2026-09-30T00:00:00Z",
    uptimeSeconds: 3600,
    lastMigrationAt: null,
    dependencies: [
      { id: "api", label: "API", status: "healthy", latencyMs: null, detail: "API 可响应" },
      {
        id: "kafka",
        label: "Kafka",
        status: kafkaStatus,
        latencyMs: null,
        detail: kafkaStatus === "healthy" ? "可连接" : "尚未监测",
      },
      {
        id: "worker",
        label: "Worker",
        status: workerStatus,
        latencyMs: null,
        detail: workerStatus === "healthy" ? "最近收到进程心跳" : "未收到心跳",
      },
    ],
    pipeline: {
      latestEventAt: null,
      kafkaLag: null,
      failedJobs: null,
      capacity: {
        status: "unknown",
        mode: "unknown",
        pressure: "unknown",
        usedBytes: null,
        freeBytes: null,
        capacityBytes: null,
        usedPercent: null,
        automaticSamplingActive: false,
        automaticSamplingRate: null,
        ingestBlocked: false,
        observedAt: null,
        detail: "容量暂不可用",
      },
    },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "overview"], overview);
  render(
    <QueryClientProvider client={client}>
      <AdminOverviewPage />
    </QueryClientProvider>,
  );
}

it("does not report the instance as fully healthy while a service is unmonitored", () => {
  renderOverview("healthy");
  expect(screen.getByText("部分待确认")).toBeTruthy();
  expect(screen.getByText("1 项待确认")).toBeTruthy();
  expect(screen.getByText("最近收到进程心跳")).toBeTruthy();
  expect(screen.queryByText("运行正常")).toBeNull();
  expect(
    screen.getByText("部分待确认").closest('[data-slot="badge"]')?.getAttribute("data-variant"),
  ).toBe("outline");
});

it("uses the success state when all monitored services are healthy", () => {
  renderOverview("healthy", "healthy");
  expect(
    screen.getByText("运行正常").closest('[data-slot="badge"]')?.getAttribute("data-variant"),
  ).toBe("success");
  expect(screen.getAllByText("正常")).toHaveLength(3);
  for (const label of screen.getAllByText("正常")) {
    expect(label.closest('[data-slot="badge"]')?.getAttribute("data-variant")).toBe("success");
  }
});

it("surfaces a missing Worker heartbeat as an actionable service problem", () => {
  renderOverview("unhealthy");
  expect(screen.getByText("需要处理")).toBeTruthy();
  expect(screen.getByText("1 项异常")).toBeTruthy();
  expect(screen.getByText("未收到心跳")).toBeTruthy();
});
