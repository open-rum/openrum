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
  it("guides an unconfigured instance and explains why saving is unavailable", async () => {
    useStorageStatus({ managedSecretsAvailable: false });
    const view = renderPage();

    expect(await view.findByText("尚未配置对象存储")).toBeTruthy();
    expect(view.getByText("配置对象存储")).toBeTruthy();
    expect(view.getByText("控制台托管尚未启用")).toBeTruthy();
    expect(view.getByLabelText("服务商")).toBeTruthy();
    expect(view.getByLabelText("Region")).toBeTruthy();
    expect(view.getByLabelText("Bucket")).toBeTruthy();
    expect(view.getByLabelText("Endpoint（可选）")).toBeTruthy();
    expect(view.getByText("需要先在部署环境启用控制台托管，才能保存")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "测试连接并保存" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("maps a concrete provider preset to the S3-compatible API payload", async () => {
    useStorageStatus({ managedSecretsAvailable: true });
    let submitted: Record<string, unknown> | undefined;
    useSave((body) => (submitted = body));
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(await view.findByLabelText("服务商"));
    await user.click(await view.findByRole("option", { name: "Cloudflare R2" }));
    expect(view.getByText("通过 R2 的 S3-compatible Endpoint 连接。")).toBeTruthy();

    await user.type(view.getByLabelText("Region"), "auto");
    await user.type(view.getByLabelText("Bucket"), "openrum-artifacts");
    await user.type(view.getByLabelText("Endpoint"), "https://account.r2.cloudflarestorage.com");
    await user.type(view.getByLabelText("R2 Access Key ID"), "r2-access-key");
    await user.type(view.getByLabelText("R2 Secret Access Key"), "r2-secret-key");
    await confirmSave(user, view);

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
  });

  it("leads with the active storage and replaces it with stored credentials kept", async () => {
    useStorageStatus({ managedSecretsAvailable: true, configured: true });
    let submitted: Record<string, unknown> | undefined;
    useSave((body) => (submitted = body));
    const user = userEvent.setup();
    const view = renderPage();

    expect(await view.findByText("当前存储")).toBeTruthy();
    expect(view.getByText("dev-h5-static")).toBeTruthy();
    expect(view.getByText("12 个 Source Map")).toBeTruthy();
    expect(view.getByText("3 MB")).toBeTruthy();
    expect(view.queryByLabelText("服务商")).toBeNull();

    await user.click(view.getByRole("button", { name: "更换配置" }));
    expect((view.getByLabelText("Bucket") as HTMLInputElement).value).toBe("dev-h5-static");
    await user.clear(view.getByLabelText("Endpoint（可选）"));
    await user.type(
      view.getByLabelText("Endpoint（可选）"),
      "https://oss-ap-southeast-1-internal.aliyuncs.com",
    );
    await confirmSave(user, view);

    await waitFor(() =>
      expect(submitted).toMatchObject({
        provider: "oss",
        bucket: "dev-h5-static",
        endpoint: "https://oss-ap-southeast-1-internal.aliyuncs.com",
        accessKeyId: "",
        secretAccessKey: "",
      }),
    );
  });

  it("requires confirmation before moving stored Source Maps to another Bucket", async () => {
    useStorageStatus({ managedSecretsAvailable: true, configured: true });
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(await view.findByRole("button", { name: "更换配置" }));
    await user.clear(view.getByLabelText("Bucket"));
    await user.type(view.getByLabelText("Bucket"), "another-bucket");
    expect(view.getByText("更换 Bucket 后，已上传的 Source Map 将无法读取")).toBeTruthy();
    const save = view.getByRole("button", { name: "测试连接并保存" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(view.getByLabelText("我了解影响，继续更换 Bucket"));
    expect(save.disabled).toBe(false);
  });

  it("shows which probe step failed when the new configuration is rejected", async () => {
    useStorageStatus({ managedSecretsAvailable: true });
    server.use(
      http.post("/api/v1/auth/reauthenticate", () =>
        HttpResponse.json({ elevated: true, expiresInSeconds: 300 }),
      ),
      http.put("/api/v1/admin/object-storage/managed", () =>
        HttpResponse.json(
          {
            success: false,
            errorCode: "bucket_not_found",
            startedAt: "2026-10-01T01:00:00Z",
            durationMs: 30,
            steps: [
              { name: "write", status: "failed", errorCode: "bucket_not_found", latencyMs: 30 },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    const view = renderPage();
    await user.type(await view.findByLabelText("Region"), "ap-southeast-1");
    await user.type(view.getByLabelText("Bucket"), "missing-bucket");
    await user.type(view.getByLabelText("OSS Access Key ID"), "LTAI-key");
    await user.type(view.getByLabelText("OSS Access Key Secret"), "secret");
    await confirmSave(user, view);
    expect(await view.findByText("对象存储测试失败")).toBeTruthy();
    expect(view.getByText("Bucket 不存在，或当前身份无法访问。")).toBeTruthy();
  });
});

async function confirmSave(
  user: ReturnType<typeof userEvent.setup>,
  view: ReturnType<typeof renderPage>,
) {
  await user.click(view.getByRole("button", { name: "测试连接并保存" }));
  await user.type(view.getByLabelText("当前密码"), "owner-password");
  await user.click(view.getByRole("button", { name: "测试并应用配置" }));
}

function useSave(capture: (body: Record<string, unknown>) => void) {
  server.use(
    http.post("/api/v1/auth/reauthenticate", () =>
      HttpResponse.json({ elevated: true, expiresInSeconds: 300 }),
    ),
    http.put("/api/v1/admin/object-storage/managed", async ({ request }) => {
      capture((await request.json()) as Record<string, unknown>);
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
}

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

function useStorageStatus({
  managedSecretsAvailable,
  configured = false,
}: {
  managedSecretsAvailable: boolean;
  configured?: boolean;
}) {
  server.use(
    http.get("/api/v1/admin/object-storage", () =>
      HttpResponse.json(
        configured
          ? {
              provider: "oss",
              providerLabel: "Alibaba OSS",
              configured: true,
              region: "ap-southeast-1",
              bucket: "dev-h5-static",
              endpoint: "https://oss-ap-southeast-1.aliyuncs.com",
              diagnosticPrefix: "openrum-diagnostics/connectivity/",
              credentialSource: "managed_encrypted",
              maskedIdentity: "LTA••••KZbU",
              managedBy: "控制台托管",
              testAvailable: true,
              managedSecretsAvailable,
              configurationSource: "managed",
              deleteAllowed: true,
              artifactCount: 12,
              artifactBytes: 3 * 1024 * 1024,
            }
          : {
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
            },
      ),
    ),
  );
}
