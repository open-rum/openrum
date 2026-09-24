// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EmergencyStorageRecovery } from "./EmergencyStorageRecovery";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.history.replaceState({}, "", "/settings/instance/retention");
});
afterAll(() => server.close());

describe("EmergencyStorageRecovery", () => {
  it("keeps the destructive workflow unavailable while capacity is safe", async () => {
    useSession();
    usePressure("normal", 42);
    useLatestJob(null);
    const view = renderRecovery();

    await waitFor(() => expect(view.getByText("当前不需要紧急清理")).toBeTruthy());
    expect(view.queryByRole("button", { name: "生成推荐清理方案" })).toBeNull();
  });

  it("previews complete months and submits phrase plus password", async () => {
    useSession();
    usePressure("blocked", 96);
    let created = false;
    let submitted: Record<string, unknown> | undefined;
    server.use(
      http.get("/api/v1/admin/emergency-cleanup/jobs/latest", () =>
        HttpResponse.json({ job: created ? jobResponse() : null }),
      ),
      http.post("/api/v1/admin/emergency-cleanup/preview", () =>
        HttpResponse.json({
          previewToken: "orec_preview",
          expiresAt: "2026-09-16T10:10:00Z",
          usedBytes: 96,
          capacityBytes: 100,
          estimatedReleaseBytes: 12,
          projectedUsedBytes: 84,
          targetUsedPercent: 85,
          protectedAfter: "2026-09-15T10:00:00Z",
          canReachTarget: true,
          groups: [
            {
              projectId: "11111111-1111-4111-8111-111111111111",
              projectName: "商城 H5",
              month: 202608,
              affectedRows: 1200,
              estimatedBytes: 12,
              oldestAt: "2026-08-01T00:00:00Z",
              newestAt: "2026-08-31T23:00:00Z",
            },
          ],
        }),
      ),
      http.post("/api/v1/admin/emergency-cleanup/jobs", async ({ request }) => {
        submitted = (await request.json()) as Record<string, unknown>;
        created = true;
        return HttpResponse.json(jobResponse(), { status: 202 });
      }),
    );
    const view = renderRecovery();

    const generate = await view.findByRole("button", { name: "生成推荐清理方案" });
    fireEvent.click(generate);
    await waitFor(() => expect(view.getByText("确认清理旧数据")).toBeTruthy());
    expect(view.getByText("商城 H5")).toBeTruthy();
    expect(view.getByText("清理后预计").parentElement?.textContent).toContain("84.0%");

    fireEvent.change(view.getByLabelText("输入“清理旧数据”确认"), {
      target: { value: "清理旧数据" },
    });
    fireEvent.change(view.getByLabelText("当前密码"), { target: { value: "local-password" } });
    fireEvent.click(view.getByRole("button", { name: "确认并开始清理" }));

    await waitFor(() =>
      expect(submitted).toEqual({
        previewToken: "orec_preview",
        confirmation: "清理旧数据",
        currentPassword: "local-password",
      }),
    );
    await waitFor(() => expect(view.getByText("正在清理旧数据")).toBeTruthy());
  });
});

function renderRecovery() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EmergencyStorageRecovery />
    </QueryClientProvider>,
  );
}

function useSession() {
  server.use(
    http.get("/api/v1/auth/me", () =>
      HttpResponse.json({
        userId: "22222222-2222-4222-8222-222222222222",
        email: "owner@openrum.local",
        displayName: "Instance Owner",
        instanceRole: "instance_owner",
      }),
    ),
  );
}

function usePressure(mode: "normal" | "blocked", usedPercent: number) {
  server.use(
    http.get("/api/v1/storage-pressure", () =>
      HttpResponse.json({
        mode,
        level: mode === "blocked" ? "critical" : "normal",
        usedPercent,
        automaticSamplingActive: mode === "blocked",
        automaticSamplingRate: mode === "blocked" ? 0 : null,
        ingestBlocked: mode === "blocked",
        observedAt: "2026-09-16T10:00:00Z",
      }),
    ),
  );
}

function useLatestJob(job: ReturnType<typeof jobResponse> | null) {
  server.use(
    http.get("/api/v1/admin/emergency-cleanup/jobs/latest", () => HttpResponse.json({ job })),
  );
}

function jobResponse() {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "running",
    usedBytesBefore: 96,
    capacityBytes: 100,
    estimatedReleaseBytes: 12,
    targetUsedPercent: 85,
    protectedAfter: "2026-09-15T10:00:00Z",
    canReachTarget: true,
    totalSteps: 2,
    completedSteps: 1,
    attempts: 1,
    createdAt: "2026-09-16T10:00:00Z",
    updatedAt: "2026-09-16T10:01:00Z",
    startedAt: "2026-09-16T10:00:05Z",
    completedAt: null,
  } as const;
}
