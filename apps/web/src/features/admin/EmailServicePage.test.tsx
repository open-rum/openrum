// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EmailServicePage } from "./EmailServicePage";

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

const managedSettings = {
  host: "smtp.example.com",
  port: 465,
  security: "tls",
  username: "mailer",
  from: "no-reply@example.com",
  passwordSet: true,
};

describe("EmailServicePage", () => {
  it("guides an unconfigured instance and explains why saving is unavailable", async () => {
    useStatus({ managedSecretsAvailable: false });
    const view = renderPage();

    expect(await view.findByText("尚未配置邮件服务")).toBeTruthy();
    expect(view.getByText("配置邮件服务")).toBeTruthy();
    expect(view.getByText("控制台托管尚未启用")).toBeTruthy();
    expect(view.getByText("需要先在部署环境启用控制台托管，才能保存")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "验证连接并保存" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("sends the default port as zero and keeps credentials out of the page afterwards", async () => {
    useStatus({ managedSecretsAvailable: true });
    let submitted: Record<string, unknown> | undefined;
    useSave((body) => (submitted = body));
    const user = userEvent.setup();
    const view = renderPage();

    await user.type(await view.findByLabelText("服务器地址"), "smtp.example.com");
    await user.type(view.getByLabelText("发件人"), "no-reply@example.com");
    await user.type(view.getByLabelText("用户名（可选）"), "mailer");
    await user.type(view.getByLabelText("密码"), "s3cret");
    await confirmSave(user, view);

    await waitFor(() =>
      expect(submitted).toEqual({
        host: "smtp.example.com",
        port: 0,
        security: "starttls",
        username: "mailer",
        password: "s3cret",
        from: "no-reply@example.com",
      }),
    );
  });

  it("changes the suggested port with the security mode and rejects credentials without encryption", async () => {
    useStatus({ managedSecretsAvailable: true });
    const user = userEvent.setup();
    const view = renderPage();

    expect((await view.findByLabelText("端口（可选）")).getAttribute("placeholder")).toBe("587");
    await user.click(view.getByLabelText("加密方式"));
    await user.click(await view.findByRole("option", { name: "TLS / SSL（SMTPS）" }));
    expect(view.getByLabelText("端口（可选）").getAttribute("placeholder")).toBe("465");

    await user.click(view.getByLabelText("加密方式"));
    await user.click(await view.findByRole("option", { name: "不加密" }));
    await user.type(view.getByLabelText("服务器地址"), "relay.internal");
    await user.type(view.getByLabelText("发件人"), "no-reply@example.com");
    await user.type(view.getByLabelText("用户名（可选）"), "mailer");
    await user.type(view.getByLabelText("密码"), "s3cret");
    expect(view.getByText("不加密时不能使用用户名和密码")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "验证连接并保存" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps the stored password when only the sender changes", async () => {
    useStatus({ managedSecretsAvailable: true, source: "managed", settings: managedSettings });
    let submitted: Record<string, unknown> | undefined;
    useSave((body) => (submitted = body));
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(await view.findByRole("button", { name: "更换配置" }));
    expect(view.getByPlaceholderText("留空沿用当前密码")).toBeTruthy();
    await user.clear(view.getByLabelText("发件人"));
    await user.type(view.getByLabelText("发件人"), "alerts@example.com");
    await confirmSave(user, view);
    await waitFor(() =>
      expect(submitted).toMatchObject({
        password: "",
        username: "mailer",
        from: "alerts@example.com",
      }),
    );
  });

  it("asks for the password again when the host changes", async () => {
    useStatus({ managedSecretsAvailable: true, source: "managed", settings: managedSettings });
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(await view.findByRole("button", { name: "更换配置" }));
    await user.clear(view.getByLabelText("服务器地址"));
    await user.type(view.getByLabelText("服务器地址"), "other.example.com");
    expect(view.getByText("请填写密码")).toBeTruthy();
    expect(view.queryByPlaceholderText("留空沿用当前密码")).toBeNull();
    expect(
      (view.getByRole("button", { name: "验证连接并保存" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("leads with the active server and sends a test message to the signed-in account", async () => {
    useStatus({ managedSecretsAvailable: true, source: "managed", settings: managedSettings });
    server.use(
      http.post("/api/v1/admin/email/test", () =>
        HttpResponse.json({ success: true, recipient: "admin@example.org" }),
      ),
    );
    const user = userEvent.setup();
    const view = renderPage();

    expect(await view.findByText("当前邮件服务")).toBeTruthy();
    expect(view.getByText("smtp.example.com:465")).toBeTruthy();
    expect(view.getByText("TLS / SSL（SMTPS）")).toBeTruthy();
    expect(view.getByText("已设置")).toBeTruthy();
    expect(view.queryByLabelText("服务器地址")).toBeNull();

    await user.click(view.getByRole("button", { name: "发送测试邮件" }));
    expect(await view.findByText("测试邮件已发出")).toBeTruthy();
    expect(view.getByText(/admin@example\.org/)).toBeTruthy();
  });

  it("shows the failing stage and the server reply when delivery is refused", async () => {
    useStatus({ managedSecretsAvailable: true, source: "managed", settings: managedSettings });
    server.use(
      http.post("/api/v1/admin/email/test", () =>
        HttpResponse.json({
          success: false,
          stage: "auth",
          message: "535 5.7.8 authentication failed",
          recipient: "admin@example.org",
        }),
      ),
    );
    const user = userEvent.setup();
    const view = renderPage();
    await user.click(await view.findByRole("button", { name: "发送测试邮件" }));

    expect(await view.findByText("邮件服务验证失败")).toBeTruthy();
    expect(view.getByText(/用户名或密码被服务器拒绝/)).toBeTruthy();
    expect(view.getByText("535 5.7.8 authentication failed")).toBeTruthy();
  });

  it("shows the stage of a rejected save and does not close the form", async () => {
    useStatus({ managedSecretsAvailable: true });
    server.use(
      http.post("/api/v1/auth/reauthenticate", () =>
        HttpResponse.json({ elevated: true, expiresInSeconds: 300 }),
      ),
      http.put("/api/v1/admin/email/managed", () =>
        HttpResponse.json(
          { success: false, stage: "connect", message: "dial tcp: lookup smtp.nowhere.test" },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    const view = renderPage();
    await user.type(await view.findByLabelText("服务器地址"), "smtp.nowhere.test");
    await user.type(view.getByLabelText("发件人"), "no-reply@example.com");
    await confirmSave(user, view);

    expect(await view.findByText("邮件服务验证失败")).toBeTruthy();
    expect(view.getByText(/无法连接到邮件服务器/)).toBeTruthy();
    expect(view.getByLabelText("服务器地址")).toBeTruthy();
  });

  it("shows a deployment-configured server as read-only", async () => {
    useStatus({
      managedSecretsAvailable: true,
      source: "deployment",
      locked: true,
      settings: { ...managedSettings, security: "starttls", port: 587 },
    });
    const view = renderPage();

    expect(await view.findByText("当前邮件服务")).toBeTruthy();
    expect(view.getByText("部署环境（SMTP_* 环境变量）")).toBeTruthy();
    expect(view.queryByRole("button", { name: "更换配置" })).toBeNull();
    expect(view.queryByRole("button", { name: "移除" })).toBeNull();
    expect(view.queryByLabelText("服务器地址")).toBeNull();
    expect(view.getByRole("button", { name: "发送测试邮件" })).toBeTruthy();
  });

  it("warns when a deployment server hides a stored Console configuration", async () => {
    useStatus({
      source: "deployment",
      locked: true,
      managedOverridden: true,
      settings: { ...managedSettings, security: "starttls", port: 587 },
    });
    const view = renderPage();
    expect(await view.findByText("控制台里保存的配置目前没有生效")).toBeTruthy();
  });

  it("removes the Console-managed server after re-authentication", async () => {
    useStatus({ managedSecretsAvailable: true, source: "managed", settings: managedSettings });
    let removed = false;
    server.use(
      http.post("/api/v1/auth/reauthenticate", () =>
        HttpResponse.json({ elevated: true, expiresInSeconds: 300 }),
      ),
      http.delete("/api/v1/admin/email/managed", () => {
        removed = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(await view.findByRole("button", { name: "移除" }));
    await user.type(view.getByLabelText("当前密码"), "owner-password");
    await user.click(view.getByRole("button", { name: "移除配置" }));
    await waitFor(() => expect(removed).toBe(true));
  });
});

async function confirmSave(
  user: ReturnType<typeof userEvent.setup>,
  view: ReturnType<typeof renderPage>,
) {
  await user.click(view.getByRole("button", { name: "验证连接并保存" }));
  await user.type(view.getByLabelText("当前密码"), "owner-password");
  await user.click(view.getByRole("button", { name: "验证并应用配置" }));
}

type StatusOverrides = Partial<{
  managedSecretsAvailable: boolean;
  source: "none" | "deployment" | "managed";
  locked: boolean;
  managedOverridden: boolean;
  settings: typeof managedSettings | null;
}>;

function useStatus(overrides: StatusOverrides = {}) {
  const source = overrides.source ?? "none";
  server.use(
    http.get("/api/v1/admin/email", () =>
      HttpResponse.json({
        configured: source !== "none",
        source,
        locked: overrides.locked ?? false,
        managedSecretsAvailable: overrides.managedSecretsAvailable ?? false,
        settings: overrides.settings ?? null,
        managedOverridden: overrides.managedOverridden ?? false,
      }),
    ),
  );
}

function useSave(capture: (body: Record<string, unknown>) => void) {
  server.use(
    http.post("/api/v1/auth/reauthenticate", () =>
      HttpResponse.json({ elevated: true, expiresInSeconds: 300 }),
    ),
    http.put("/api/v1/admin/email/managed", async ({ request }) => {
      capture((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ configured: true, version: 1 });
    }),
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EmailServicePage />
    </QueryClientProvider>,
  );
}
