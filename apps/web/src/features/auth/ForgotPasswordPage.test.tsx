// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ForgotPasswordPage } from "./ForgotPasswordPage";

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

function renderForgotPassword() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ForgotPasswordPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("ForgotPasswordPage", () => {
  it("shows CLI recovery guidance when the instance has no mail server", async () => {
    server.use(
      http.get("/api/v1/auth/password-reset/status", () => HttpResponse.json({ enabled: false })),
    );
    const view = renderForgotPassword();

    expect(await view.findByText(/当前实例尚未配置邮件服务/)).toBeTruthy();
    expect(view.getByText(/\/app\/api reset-password/)).toBeTruthy();
    expect(view.getByRole("link", { name: "返回登录" }).getAttribute("href")).toBe("/login");
  });

  it("submits email and shows non-enumerating confirmation when SMTP is configured", async () => {
    let submitted: Record<string, unknown> | undefined;
    server.use(
      http.get("/api/v1/auth/password-reset/status", () => HttpResponse.json({ enabled: true })),
      http.post("/api/v1/auth/password-reset/request", async ({ request }) => {
        submitted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ status: "reset_sent" }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    const view = renderForgotPassword();

    await user.type(await view.findByLabelText("邮箱"), "Owner@Example.com");
    await user.click(view.getByRole("button", { name: "发送重置链接" }));

    await waitFor(() => expect(submitted).toEqual({ email: "Owner@Example.com" }));
    expect(await view.findByRole("heading", { name: "请查收重置邮件" })).toBeTruthy();
    expect(view.getByText(/owner@example\.com/)).toBeTruthy();
  });
});
