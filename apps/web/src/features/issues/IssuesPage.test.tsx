// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { IssuesPage } from "./IssuesPage";

const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
const organizationId = "018f4d9c-83a1-76c9-81c2-3020ab660001";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.history.replaceState({}, "", "/issues");
});
afterAll(() => server.close());

describe("issues page states", () => {
  it("renders loading then empty state", async () => {
    useControlPlaneHandlers();
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, async () => {
        await delay(50);
        return HttpResponse.json({ issues: [], facets: emptyFacets() });
      }),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByLabelText("正在加载问题")).toBeTruthy());
    await waitFor(() => expect(view.getByText("当前范围没有匹配的问题")).toBeTruthy());
  });

  it("renders a populated table", async () => {
    useControlPlaneHandlers();
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, () =>
        HttpResponse.json({
          issues: [
            {
              fingerprint: "v1:checkout",
              fingerprintVersion: 1,
              title: "TypeError: checkout failed",
              errorType: "TypeError",
              events: 42,
              users: 18,
              sessions: 20,
              firstSeenAt: "2026-09-03T10:00:00Z",
              lastSeenAt: "2026-09-03T11:00:00Z",
              status: "unresolved",
              assigneeUserId: null,
              resolvedInReleaseId: null,
            },
          ],
          nextCursor: "abc",
          facets: emptyFacets(),
        }),
      ),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: checkout failed")).toBeTruthy());
    expect(view.getByText("本页 1 个问题")).toBeTruthy();
  });

  it("renders a bounded error state", async () => {
    useControlPlaneHandlers();
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, () =>
        HttpResponse.json({ error: { code: "QUERY_UNAVAILABLE" } }, { status: 503 }),
      ),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("无法加载问题列表")).toBeTruthy());
    expect(view.container.textContent).not.toContain("private-clickhouse");
  });

  it("searches this page without an extra request and restores the query from the URL", async () => {
    useControlPlaneHandlers();
    let requests = 0;
    window.history.replaceState({}, "", "/issues?search=checkout");
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, () => {
        requests++;
        return HttpResponse.json({
          issues: [issue("checkout"), issue("profile")],
          facets: emptyFacets(),
        });
      }),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: checkout")).toBeTruthy());
    expect(view.queryByText("TypeError: profile")).toBeNull();
    fireEvent.change(view.getByRole("searchbox"), { target: { value: "not-found" } });
    expect(view.getByText("本页没有匹配的搜索结果")).toBeTruthy();
    fireEvent.click(view.getByText("清除搜索"));
    expect(view.getByText("TypeError: profile")).toBeTruthy();
    expect(requests).toBe(1);
  });

  it("paginates independently of browser history, including empty intermediate pages", async () => {
    useControlPlaneHandlers();
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        return HttpResponse.json({
          issues: cursor === "second" ? [] : [issue(cursor === "third" ? "last" : "first")],
          nextCursor: cursor === "third" ? undefined : cursor === "second" ? "third" : "second",
          facets: emptyFacets(),
        });
      }),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: first")).toBeTruthy());
    fireEvent.click(view.getByText("下一页"));
    await waitFor(() => expect(view.getByText("本页没有匹配状态的问题")).toBeTruthy());
    fireEvent.click(view.getByText("下一页"));
    await waitFor(() => expect(view.getByText("TypeError: last")).toBeTruthy());
    fireEvent.click(view.getByText("上一页"));
    await waitFor(() => expect(view.getByText("本页没有匹配状态的问题")).toBeTruthy());
    await waitFor(() =>
      expect((view.getByText("上一页").closest("button") as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(view.getByText("上一页"));
    await waitFor(() => expect(view.getByText("TypeError: first")).toBeTruthy());
    expect(window.location.pathname).toBe("/issues");
    expect(new URLSearchParams(window.location.search).has("cursor")).toBe(false);
  });

  it("clears local filters without clearing shared time and environment", async () => {
    useControlPlaneHandlers();
    window.history.replaceState(
      {},
      "",
      "/issues?environment=production&status=resolved&browser=Safari&from=2026-09-11T00:00:00Z&to=2026-09-12T00:00:00Z",
    );
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, () =>
        HttpResponse.json({ issues: [issue("checkout")], facets: emptyFacets() }),
      ),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: checkout")).toBeTruthy());
    expect(view.getByRole("combobox", { name: "浏览器" }).textContent).toContain("Safari");
    fireEvent.click(view.getByText("清除筛选"));
    const search = new URLSearchParams(window.location.search);
    expect(search.get("environment")).toBe("production");
    expect(search.get("from")).toBe("2026-09-11T00:00:00.000Z");
    expect(search.has("status")).toBe(false);
    expect(search.has("browser")).toBe(false);
  });

  it("provides a safe first-page action for a directly opened cursor", async () => {
    useControlPlaneHandlers();
    window.history.replaceState({}, "", "/issues?cursor=second");
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, () =>
        HttpResponse.json({ issues: [issue("checkout")], facets: emptyFacets() }),
      ),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("返回首页")).toBeTruthy());
    fireEvent.click(view.getByText("返回首页"));
    expect(new URLSearchParams(window.location.search).has("cursor")).toBe(false);
  });
});

function issue(name: string) {
  return {
    fingerprint: `v1:${name}`,
    fingerprintVersion: 1,
    title: `TypeError: ${name}`,
    errorType: "TypeError",
    events: 42,
    users: 18,
    sessions: 20,
    firstSeenAt: "2026-09-11T10:00:00Z",
    lastSeenAt: "2026-09-11T11:00:00Z",
    status: "unresolved",
    assigneeUserId: null,
    resolvedInReleaseId: null,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IssuesPage />
    </QueryClientProvider>,
  );
}

function useControlPlaneHandlers() {
  server.use(
    http.get("/api/v1/organizations", () =>
      HttpResponse.json({
        organizations: [
          {
            id: organizationId,
            name: "OpenRUM",
            slug: "openrum",
            role: "owner",
            createdAt: "2026-09-03T00:00:00Z",
            updatedAt: "2026-09-03T00:00:00Z",
          },
        ],
      }),
    ),
    http.get(`/api/v1/organizations/${organizationId}/projects`, () =>
      HttpResponse.json({
        projects: [
          {
            id: projectId,
            organizationId,
            name: "Web H5",
            slug: "web-h5",
            allowedOrigins: [],
            environment: "production",
            retentionDays: 14,
            eventSampleRate: 1,
            apiSampleRate: 0.2,
            errorSampleRate: 1,
            status: "active",
            role: "owner",
            createdAt: "2026-09-03T00:00:00Z",
            updatedAt: "2026-09-03T00:00:00Z",
          },
        ],
      }),
    ),
  );
}

function emptyFacets() {
  return { environments: [], releases: [], browsers: [], deviceTypes: [], countries: [] };
}
