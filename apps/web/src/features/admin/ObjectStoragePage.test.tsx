// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectStoragePage } from "./ObjectStoragePage";

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("ObjectStoragePage", () => {
  it("keeps the provider form visible when managed secrets are disabled", async () => {
    useStorageStatus(false);
    const view = renderPage();

    expect(await view.findByText("配置对象存储")).toBeTruthy();
    expect(view.getByText("页面保存功能尚未启用")).toBeTruthy();
    expect(view.getByLabelText("Provider")).toBeTruthy();
    expect(view.getByLabelText("Region")).toBeTruthy();
    expect(view.getByLabelText("Bucket")).toBeTruthy();
    expect(view.getByLabelText("Endpoint（可选）")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "启用安全存储后可保存" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("maps a concrete provider preset to the S3-compatible API payload", async () => {
    useStorageStatus(true);
    let submitted: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/v1/auth/reauthenticate", () =>
        HttpResponse.json({ elevated: true, expiresInSeconds: 300 }),
      ),
      http.put("/api/v1/admin/object-storage/managed", async ({ request }) => {
        submitted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          configured: true,
          version: 2,
          keyId: "v1",
          probe: {
            success: true,
            startedAt: "2026-09-21T02:00:00Z",
            durationMs: 18,
            steps: [
              { name: "write", status: "passed", latencyMs: 8 },
              { name: "read", status: "passed", latencyMs: 6 },
              { name: "delete", status: "passed", latencyMs: 4 },
            ],
          },
        });
      }),
    );
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(await view.findByLabelText("Provider"));
    await user.click(await view.findByRole("option", { name: "Cloudflare R2" }));
    expect(view.getByText("通过 R2 的 S3-compatible Endpoint 连接。")).toBeTruthy();

    await user.type(view.getByLabelText("Region"), "auto");
    await user.type(view.getByLabelText("Bucket"), "openrum-artifacts");
    await user.type(view.getByLabelText("Endpoint"), "https://account.r2.cloudflarestorage.com");
    await user.type(view.getByLabelText("R2 Access Key ID"), "r2-access-key");
    await user.type(view.getByLabelText("R2 Secret Access Key"), "r2-secret-key");
    await user.click(view.getByRole("button", { name: "测试连接并保存" }));
    await user.type(view.getByLabelText("当前密码"), "owner-password");
    await user.click(view.getByRole("button", { name: "测试并应用配置" }));

    await waitFor(() =>
      expect(submitted).toEqual({
        provider: "s3",
        endpoint: "https://account.r2.cloudflarestorage.com",
        bucket: "openrum-artifacts",
        region: "auto",
        accessKeyId: "r2-access-key",
        secretAccessKey: "r2-secret-key",
        forcePathStyle: false,
      }),
    );
    expect(await view.findByText("对象存储连接正常")).toBeTruthy();
  });
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ObjectStoragePage />
    </QueryClientProvider>,
  );
}

function useStorageStatus(managedSecretsAvailable: boolean) {
  server.use(
    http.get("/api/v1/admin/object-storage", () =>
      HttpResponse.json({
        provider: "none",
        providerLabel: "未启用",
        configured: false,
        region: "",
        bucket: "",
        endpoint: "—",
        diagnosticPrefix: "openrum-diagnostics/connectivity/",
        credentialSource: "none",
        maskedIdentity: "",
        managedBy: "未配置",
        testAvailable: false,
        managedSecretsAvailable,
        configurationSource: "deployment",
      }),
    ),
  );
}
