// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AwaitingAccessPage } from "./AwaitingAccessPage";

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

it("shows only status and sign-out actions while organization access is pending", async () => {
  server.use(
    http.get("/api/v1/auth/me", () =>
      HttpResponse.json({
        userId: "pending",
        email: "new@example.test",
        displayName: "New user",
        accessStatus: "pending",
        hasPassword: false,
      }),
    ),
  );
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/awaiting-access",
    component: AwaitingAccessPage,
    validateSearch: (search: Record<string, unknown>) => ({
      returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
    }),
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ["/awaiting-access?returnTo=%2Fprojects%2Fexample"],
    }),
  });
  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  expect(await view.findByText(/new@example.test/)).toBeTruthy();
  expect(view.getByRole("button", { name: "检查状态" })).toBeTruthy();
  expect(view.getByRole("button", { name: "退出登录" })).toBeTruthy();
  expect(view.queryByRole("link", { name: "创建组织" })).toBeNull();
});
