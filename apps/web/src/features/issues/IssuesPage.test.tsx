// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { IssuesPage } from "./IssuesPage";

const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
const organizationId = "018f4d9c-83a1-76c9-81c2-3020ab660001";
const server = setupServer();
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.history.replaceState({}, "", "/issues");
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

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

  it("renders real overview charts and switches impact and distribution dimensions", async () => {
    useControlPlaneHandlers();
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, () =>
        HttpResponse.json({ issues: [issue("checkout")], facets: emptyFacets() }),
      ),
      http.get(`/api/v1/projects/${projectId}/issues/overview`, () =>
        HttpResponse.json({
          trend: [
            {
              bucket: "2026-09-11T10:00:00Z",
              events: 12,
              anonymousUsers: 8,
              identifiedUsers: 5,
              sessions: 9,
              pages: 7,
            },
            {
              bucket: "2026-09-11T11:00:00Z",
              events: 18,
              anonymousUsers: 11,
              identifiedUsers: 7,
              sessions: 13,
              pages: 10,
            },
          ],
          errorTypes: [{ value: "TypeError", events: 20 }],
          pages: [{ value: "/checkout", events: 16 }],
          countries: [{ value: "CN", events: 14 }],
        }),
      ),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByLabelText("错误概览")).toBeTruthy());
    expect(view.getByLabelText("事件趋势")).toBeTruthy();
    expect(view.getByLabelText("按错误类型的错误占比").textContent).toContain("TypeError");

    fireEvent.click(within(view.getByLabelText("切换趋势指标")).getByText("用户"));
    expect(view.getByLabelText("用户趋势")).toBeTruthy();

    fireEvent.click(within(view.getByLabelText("切换错误分布维度")).getByText("国家"));
    expect(view.getByLabelText("按国家的错误占比")).toBeTruthy();
  });

  it("applies one change to the selected rows in a single request", async () => {
    useControlPlaneHandlers();
    let batch: { issues: { fingerprint: string }[]; status?: string } | undefined;
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, () =>
        HttpResponse.json({ issues: [issue("a"), issue("b")], facets: emptyFacets() }),
      ),
      http.get(`/api/v1/organizations/${organizationId}/members`, () =>
        HttpResponse.json({ members: [] }),
      ),
      http.post(`/api/v1/projects/${projectId}/issues/batch`, async ({ request }) => {
        batch = (await request.json()) as typeof batch;
        return HttpResponse.json({ updated: 2 });
      }),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: a")).toBeTruthy());
    expect(view.queryByRole("toolbar", { name: "批量操作" })).toBeNull();

    fireEvent.click(view.getByRole("checkbox", { name: "选择问题：TypeError: a" }));
    expect(view.getByText("已选 1 个问题")).toBeTruthy();
    fireEvent.click(view.getByRole("checkbox", { name: "选择本页全部问题" }));
    expect(view.getByText("已选 2 个问题")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "标记解决" }));
    await waitFor(() => expect(batch).toBeTruthy());
    expect(batch?.status).toBe("resolved");
    expect(batch?.issues.map((item) => item.fingerprint)).toEqual(["v1:a", "v1:b"]);
    // A finished change clears the selection and puts the heading back.
    await waitFor(() => expect(view.queryByRole("toolbar", { name: "批量操作" })).toBeNull());
    expect(view.getByText("问题列表")).toBeTruthy();
  });

  it("offers no selection to viewers", async () => {
    useControlPlaneHandlers();
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, () =>
        HttpResponse.json({ issues: [issue("a")], facets: emptyFacets() }),
      ),
    );
    server.use(
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
              role: "viewer",
              createdAt: "2026-09-03T00:00:00Z",
              updatedAt: "2026-09-03T00:00:00Z",
            },
          ],
        }),
      ),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: a")).toBeTruthy());
    expect(view.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("filters by the quick chips and writes them to the URL", async () => {
    useControlPlaneHandlers();
    const requests: URLSearchParams[] = [];
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json({ issues: [issue("a")], facets: emptyFacets() });
      }),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: a")).toBeTruthy());
    const chips = within(view.getByRole("group", { name: "快捷筛选" }));
    fireEvent.click(chips.getByRole("button", { name: "未分配" }));
    await waitFor(() => expect(requests.at(-1)?.get("assignee")).toBe("none"));
    fireEvent.click(chips.getByRole("button", { name: "分配给我" }));
    await waitFor(() => expect(requests.at(-1)?.get("assignee")).toBe("me"));
    fireEvent.click(chips.getByRole("button", { name: "新问题" }));
    await waitFor(() => expect(requests.at(-1)?.get("new")).toBe("1"));
    const search = new URLSearchParams(window.location.search);
    expect(search.get("assignee")).toBe("me");
    expect(search.get("new")).toBe("1");
    fireEvent.click(view.getByText("清除筛选"));
    await waitFor(() => expect(requests.at(-1)?.has("assignee")).toBe(false));
    expect(requests.at(-1)?.has("new")).toBe(false);
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

  it("searches Issue titles on the server and restores the legacy query from the URL", async () => {
    useControlPlaneHandlers();
    window.history.replaceState({}, "", "/issues?search=checkout");
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, ({ request }) => {
        const title = new URL(request.url).searchParams.get("title")?.toLowerCase();
        const issues = [issue("checkout"), issue("profile")].filter(
          (candidate) => !title || candidate.title.toLowerCase().includes(title),
        );
        return HttpResponse.json({
          issues,
          facets: emptyFacets(),
        });
      }),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: checkout")).toBeTruthy());
    expect(view.queryByText("TypeError: profile")).toBeNull();
    expect(view.getByText("错误标题：checkout")).toBeTruthy();
    fireEvent.click(view.getByLabelText("移除筛选：错误标题：checkout"));
    await waitFor(() => expect(view.getByText("TypeError: profile")).toBeTruthy());
    const composer = view.getByLabelText("搜索错误或添加筛选条件");
    fireEvent.change(composer, { target: { value: "not-found" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(view.getByText("当前范围没有匹配的问题")).toBeTruthy());
    fireEvent.click(view.getByText("清除筛选"));
    await waitFor(() => expect(view.getByText("TypeError: profile")).toBeTruthy());
    expect(new URLSearchParams(window.location.search).has("search")).toBe(false);
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
    expect(view.getByRole("combobox", { name: "问题状态" }).textContent).toContain("已解决");
    expect(view.getByText("浏览器：Safari")).toBeTruthy();
    expect(view.queryByText("维度筛选")).toBeNull();
    fireEvent.focus(view.getByLabelText("搜索错误或添加筛选条件"));
    expect(view.getByText("添加筛选条件")).toBeTruthy();
    expect(view.getByText("错误标题")).toBeTruthy();
    // The overview's distribution switch also says 错误类型.
    expect(view.getAllByText("错误类型").length).toBeGreaterThan(1);
    expect(view.getByText("Fingerprint")).toBeTruthy();
    expect(view.getByText("用户 ID")).toBeTruthy();
    expect(view.getByText("国家 / 地区")).toBeTruthy();
    expect(view.getByText("页面 Route")).toBeTruthy();
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
    http.get(`/api/v1/projects/${projectId}/issues/overview`, () =>
      HttpResponse.json({
        trend: [],
        errorTypes: [],
        pages: [],
        countries: [],
      }),
    ),
  );
}

function emptyFacets() {
  return { environments: [], releases: [], browsers: [], deviceTypes: [], countries: [] };
}
