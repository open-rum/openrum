// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { LoginPage } from "./LoginPage";

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

function renderLogin(externalError?: "cancelled" | "expired") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <LoginPage returnTo="/projects/example" expired externalError={externalError} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("login methods", () => {
  it("keeps local sign-in and only shows enabled methods returned by the API", async () => {
    server.use(
      http.get("/api/v1/auth/methods", () =>
        HttpResponse.json({
          local: true,
          providers: [
            { id: "google", kind: "google", label: "Google" },
            { id: "company", kind: "oidc", label: "企业 SSO" },
            { id: "ldap", kind: "ldap", label: "公司目录" },
          ],
        }),
      ),
    );
    const view = renderLogin();
    expect(await view.findByRole("button", { name: "使用 Google 登录" })).toBeTruthy();
    expect(view.getByRole("button", { name: "使用 企业 SSO 登录" })).toBeTruthy();
    expect(view.getByRole("button", { name: "使用 公司目录 登录" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "使用 GitHub 登录" })).toBeNull();
    expect(view.getByRole("form", { name: "登录 OpenRUM" })).toBeTruthy();
    expect(view.getByText("登录已过期，请重新登录。完成后会返回刚才的页面。")).toBeTruthy();
  });

  it("shows the LDAP form, submits the safe return address and explains rejected credentials", async () => {
    server.use(
      http.get("/api/v1/auth/methods", () =>
        HttpResponse.json({
          local: true,
          providers: [{ id: "ldap", kind: "ldap", label: "公司目录" }],
        }),
      ),
    );
    let submitted: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/v1/auth/providers/ldap/ldap/login", async ({ request }) => {
        submitted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { error: { code: "INVALID_CREDENTIALS", message: "Directory credentials are invalid." } },
          { status: 401 },
        );
      }),
    );
    const user = userEvent.setup();
    const view = renderLogin();
    await user.click(await view.findByRole("button", { name: "使用 公司目录 登录" }));
    await user.type(view.getByRole("textbox", { name: "目录用户名" }), "alice");
    await user.type(view.getByLabelText("目录密码"), "wrong-password");
    await user.click(
      view.getByRole("form", { name: "公司目录 登录" }).querySelector('button[type="submit"]')!,
    );
    await waitFor(() =>
      expect(submitted).toEqual({
        username: "alice",
        password: "wrong-password",
        returnTo: "/projects/example",
      }),
    );
    expect(await view.findByRole("alert")).toBeTruthy();
    expect(view.getByRole("form", { name: "登录 OpenRUM" })).toBeTruthy();
  });

  it("distinguishes cancelled authorization from an expired callback", async () => {
    server.use(
      http.get("/api/v1/auth/methods", () => HttpResponse.json({ local: true, providers: [] })),
    );
    const cancelled = renderLogin("cancelled");
    expect(cancelled.getByText("已取消外部授权，您可以选择其他登录方式。")).toBeTruthy();
    cleanup();
    const expired = renderLogin("expired");
    expect(expired.getByText("外部登录已过期，请重新开始。")).toBeTruthy();
  });
});
