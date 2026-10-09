// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AdminAuthProvider } from "@/lib/auth/providers";
import { AuthenticationPage } from "./AuthenticationPage";

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

function renderPage(managedSecretsAvailable: boolean, providers: AdminAuthProvider[] = []) {
  server.use(
    http.get("/api/v1/auth/me", () =>
      HttpResponse.json({
        userId: "owner",
        email: "owner@example.test",
        displayName: "Owner",
        instanceRole: "instance_owner",
        accessStatus: "approved",
        hasPassword: true,
      }),
    ),
    http.get("/api/v1/admin/authentication", () =>
      HttpResponse.json({ managedSecretsAvailable, providers }),
    ),
  );
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthenticationPage />
    </QueryClientProvider>,
  );
}

describe("Instance authentication settings", () => {
  it("shows the key prerequisite and disables edits when managed secrets are unavailable", async () => {
    const view = renderPage(false);
    const user = userEvent.setup();
    expect(await view.findByText("需要启用加密托管")).toBeTruthy();
    expect(view.getByText(/OPENRUM_MASTER_KEY/)).toBeTruthy();
    expect(view.queryByRole("button", { name: "保存配置" })).toBeNull();
    const github = view.getByRole("button", { name: "选择 GitHub 登录方式" });
    expect(github.hasAttribute("disabled")).toBe(false);
    github.focus();
    await user.keyboard("{Enter}");
    expect(github.getAttribute("aria-pressed")).toBe("true");
    expect((view.getByLabelText("提供者 ID") as HTMLInputElement).value).toBe("github");
    await user.click(view.getByRole("button", { name: "选择 通用 OIDC 登录方式" }));
    expect(view.getByLabelText("Issuer URL")).toBeTruthy();
    expect(view.queryByRole("combobox", { name: "类型" })).toBeNull();
  });

  it("reverifies the Owner before saving and never displays the saved secret", async () => {
    const view = renderPage(true);
    const user = userEvent.setup();
    let saved: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/v1/auth/reauthenticate", () =>
        HttpResponse.json({ elevated: true, expiresInSeconds: 300 }),
      ),
      http.put("/api/v1/admin/authentication/providers/google", async ({ request }) => {
        saved = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await view.findByRole("button", { name: "保存配置" });
    await user.type(view.getByRole("textbox", { name: "Client ID" }), "google-client");
    await user.type(view.getByLabelText("Client Secret"), "private-secret");
    await user.click(view.getByRole("checkbox", { name: "启用并在登录页展示" }));
    await user.click(view.getByRole("button", { name: "保存配置" }));
    await user.type(view.getByLabelText("当前密码"), "owner-password");
    await user.click(view.getByRole("button", { name: "确认并继续" }));
    await waitFor(() =>
      expect(saved).toMatchObject({
        kind: "google",
        enabled: true,
        secret: "private-secret",
        settings: { clientId: "google-client" },
      }),
    );
    expect(await view.findByText("登录方式已保存。")).toBeTruthy();
    expect(view.queryByText("private-secret")).toBeNull();
  });

  it("allows a saved disabled provider to be tested before enabling it", async () => {
    const view = renderPage(true, [
      {
        id: "directory",
        kind: "ldap",
        label: "Directory",
        enabled: false,
        configured: true,
        version: 1,
        settings: { ldapUrl: "ldaps://directory.example.test" },
      },
    ]);
    const user = userEvent.setup();
    let tested = false;
    server.use(
      http.post("/api/v1/auth/reauthenticate", () =>
        HttpResponse.json({ elevated: true, expiresInSeconds: 300 }),
      ),
      http.post("/api/v1/admin/authentication/providers/directory/test", () => {
        tested = true;
        return HttpResponse.json({ connected: true });
      }),
    );
    await user.click(await view.findByRole("button", { name: /Directory/ }));
    await user.click(view.getByRole("button", { name: "测试连接" }));
    await user.type(view.getByLabelText("当前密码"), "owner-password");
    await user.click(view.getByRole("button", { name: "确认并继续" }));
    await waitFor(() => expect(tested).toBe(true));
    expect(await view.findByText(/目录连接测试成功/)).toBeTruthy();
  });
});
