// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ResetPasswordPage } from "./ResetPasswordPage";

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

function renderResetPassword(token = "orpr_test_token", onSuccess?: () => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ResetPasswordPage token={token} onSuccess={onSuccess} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("ResetPasswordPage", () => {
  it("submits matching valid passwords and invokes onSuccess", async () => {
    let submitted: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/v1/auth/password-reset/confirm", async ({ request }) => {
        submitted = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    const view = renderResetPassword("orpr_valid_123", onSuccess);

    await user.type(view.getByLabelText("新密码"), "StrongPass123!");
    await user.type(view.getByLabelText("确认新密码"), "StrongPass123!");
    await user.click(view.getByRole("button", { name: "确认重置密码" }));

    await waitFor(() =>
      expect(submitted).toEqual({ token: "orpr_valid_123", password: "StrongPass123!" }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("shows a link to request a new reset email when the token is expired", async () => {
    server.use(
      http.post("/api/v1/auth/password-reset/confirm", () =>
        HttpResponse.json(
          { error: { code: "PASSWORD_RESET_INVALID", message: "Invalid or expired token." } },
          { status: 410 },
        ),
      ),
    );
    const user = userEvent.setup();
    const view = renderResetPassword("orpr_expired");

    await user.type(view.getByLabelText("新密码"), "StrongPass123!");
    await user.type(view.getByLabelText("确认新密码"), "StrongPass123!");
    await user.click(view.getByRole("button", { name: "确认重置密码" }));

    expect((await view.findByRole("alert")).textContent).toContain("该密码重置链接无效或已过期");
    expect(view.getByRole("link", { name: "重新申请重置链接" }).getAttribute("href")).toBe(
      "/forgot-password",
    );
  });

  it("rejects mismatched confirmation before sending a request", async () => {
    const user = userEvent.setup();
    const view = renderResetPassword();

    await user.type(view.getByLabelText("新密码"), "StrongPass123!");
    await user.type(view.getByLabelText("确认新密码"), "AnotherPass123!");
    await user.click(view.getByRole("button", { name: "确认重置密码" }));

    expect((await view.findByRole("alert")).textContent).toContain("两次输入的密码不一致");
  });
});
