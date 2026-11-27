// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { SetupOptionalView, type OptionalSetupStep } from "./SetupOptionalPage";

const server = setupServer();
beforeAll(() => {
  window.matchMedia = (media) => ({
    matches: false,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function installAdminHandlers(emailConfigured: boolean) {
  server.use(
    http.get("/api/v1/admin/email", () =>
      HttpResponse.json(
        emailConfigured
          ? {
              configured: true,
              source: "deployment",
              locked: true,
              managedSecretsAvailable: false,
              settings: {
                host: "smtp.example.com",
                port: 587,
                security: "starttls",
                username: "mailer@example.com",
                from: "OpenRUM <noreply@example.com>",
                passwordSet: true,
              },
              managedOverridden: false,
            }
          : {
              configured: false,
              source: "none",
              locked: false,
              managedSecretsAvailable: true,
              settings: null,
              managedOverridden: false,
            },
      ),
    ),
    http.get("/api/v1/admin/object-storage", () =>
      HttpResponse.json({
        provider: "none",
        providerLabel: "未配置",
        configured: false,
        region: "",
        bucket: "",
        endpoint: "",
        diagnosticPrefix: "",
        credentialSource: "none",
        maskedIdentity: "",
        managedBy: "none",
        testAvailable: false,
        managedSecretsAvailable: true,
        configurationSource: "none",
        deleteAllowed: true,
      }),
    ),
    http.get("/api/v1/admin/authentication", () =>
      HttpResponse.json({
        managedSecretsAvailable: true,
        publicBaseUrl: "https://rum.example.com",
        providers: [],
      }),
    ),
    http.get("/api/v1/auth/registration", () => HttpResponse.json({ open: false, email: false })),
    http.get("/api/v1/admin/configuration", () => HttpResponse.json({ settings: [] })),
    http.get("/api/v1/auth/me", () =>
      HttpResponse.json({
        userId: "u-1",
        email: "owner@example.com",
        displayName: "Owner",
        instanceRole: "instance_owner",
        accessStatus: "approved",
        hasPassword: true,
      }),
    ),
  );
}

function renderSetupOptional(explicitStep?: OptionalSetupStep) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSelectStep = vi.fn();
  const onEnterConsole = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <SetupOptionalView
          explicitStep={explicitStep}
          onSelectStep={onSelectStep}
          onEnterConsole={onEnterConsole}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, onSelectStep, onEnterConsole };
}

describe("SetupOptionalView", () => {
  it("puts email service first and allows skipping to object storage when SMTP is not configured", async () => {
    installAdminHandlers(false);
    const user = userEvent.setup();
    const view = renderSetupOptional();

    const tabs = await view.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "1.邮件服务",
      "2.对象存储",
      "3.认证与访问",
      "4.数据生命周期",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(view.getByText("第 1 / 4 步")).toBeTruthy();

    await user.click(view.getByRole("button", { name: "跳过此步" }));
    expect(view.onSelectStep).toHaveBeenCalledWith("storage");
  });

  it("automatically skips email step when SMTP is already configured via environment variables", async () => {
    installAdminHandlers(true);
    const view = renderSetupOptional();

    await waitFor(() => {
      expect(view.getByText("第 2 / 4 步")).toBeTruthy();
    });
    expect(view.getByText(/邮件服务已通过环境变量启用，已自动跳过/)).toBeTruthy();
    const tabs = view.getAllByRole("tab");
    expect(tabs[0].textContent).toContain("已启用");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });

  it("stays on email step when explicitly selected even if SMTP is already configured", async () => {
    installAdminHandlers(true);
    const view = renderSetupOptional("email");

    await waitFor(() => {
      const tabs = view.getAllByRole("tab");
      expect(tabs[0].textContent).toContain("已启用");
    });
    expect(view.getByText("第 1 / 4 步")).toBeTruthy();
    expect(view.queryByText(/已自动跳过/)).toBeNull();
  });
});
