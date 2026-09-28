// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { AccountPage } from "./AccountPage";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

it("links an LDAP identity explicitly and enrolls a separate OpenRUM password", async () => {
  let linked = false;
  let hasPassword = false;
  let linkBody: Record<string, unknown> | undefined;
  let passwordBody: Record<string, unknown> | undefined;
  server.use(
    http.get("/api/v1/auth/methods", () =>
      HttpResponse.json({
        local: true,
        providers: [{ id: "ldap", kind: "ldap", label: "公司目录" }],
      }),
    ),
    http.get("/api/v1/auth/identities", () =>
      HttpResponse.json({
        identities: linked
          ? [{ id: "linked-id", providerId: "ldap", kind: "ldap", label: "公司目录" }]
          : [],
      }),
    ),
    http.get("/api/v1/auth/me", () =>
      HttpResponse.json({
        userId: "member",
        email: "member@example.test",
        displayName: "Member",
        accessStatus: "approved",
        hasPassword,
      }),
    ),
    http.post("/api/v1/auth/providers/ldap/ldap/link", async ({ request }) => {
      linkBody = (await request.json()) as Record<string, unknown>;
      linked = true;
      return new HttpResponse(null, { status: 204 });
    }),
    http.post("/api/v1/auth/password/set", async ({ request }) => {
      passwordBody = (await request.json()) as Record<string, unknown>;
      hasPassword = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["auth", "session"], {
    userId: "member",
    email: "member@example.test",
    displayName: "Member",
    accessStatus: "approved",
    hasPassword: false,
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AccountPage />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await view.findByRole("button", { name: "连接 公司目录" }));
  await user.type(view.getByRole("textbox", { name: "目录用户名" }), "member");
  await user.type(view.getByLabelText("目录密码"), "directory-password");
  await user.click(view.getByRole("button", { name: "确认连接" }));
  await waitFor(() =>
    expect(linkBody).toEqual({ username: "member", password: "directory-password" }),
  );
  expect(await view.findByText("目录身份已连接。")).toBeTruthy();
  await user.type(view.getByLabelText("新密码"), "a-new-openrum-password");
  await user.type(view.getByLabelText("确认新密码"), "a-new-openrum-password");
  await user.click(view.getByRole("button", { name: "设置密码" }));
  await waitFor(() => expect(passwordBody).toEqual({ password: "a-new-openrum-password" }));
  expect(await view.findByText(/OpenRUM 密码已设置/)).toBeTruthy();
});
