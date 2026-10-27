// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { IssuesPage } from "./IssuesPage";

const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
const organizationId = "018f4d9c-83a1-76c9-81c2-3020ab660001";
// The owner column asks for members on every render; tests that care replace this.
const server = setupServer(
  http.get(`/api/v1/organizations/${organizationId}/members`, () =>
    HttpResponse.json({ members: [] }),
  ),
);
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
      http.get(`/api/v1/organizations/${organizationId}/members`, () =>
        HttpResponse.json({ members: [] }),
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

  it("opens on unresolved Issues and keeps status and owner in the search", async () => {
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
    const box = view.getByRole("combobox", { name: "搜索错误问题" }) as HTMLInputElement;
    expect(box.value).toBe("is:unresolved");
    expect(requests.at(-1)?.get("q")).toBe("is:unresolved");
    expect(view.queryByRole("combobox", { name: "问题状态" })).toBeNull();

    fireEvent.change(box, { target: { value: "is:unassigned is:new" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(requests.at(-1)?.get("q")).toBe("is:unassigned AND is:new"));
    // The URL keeps what was typed; the request reads it as conditions joined by AND.
    expect(new URLSearchParams(window.location.search).get("q")).toBe("is:unassigned is:new");

    // A cleared search stays cleared: every Issue, not the default again.
    fireEvent.click(view.getByLabelText("清空查询"));
    await waitFor(() => expect(requests.at(-1)?.get("q")).toBe(""));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("");
    expect(box.value).toBe("");
  });

  it("turns legacy status, owner and new parameters into search conditions", async () => {
    useControlPlaneHandlers();
    window.history.replaceState({}, "", "/issues?status=resolved&assignee=none&new=1");
    const requests: URLSearchParams[] = [];
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json({ issues: [issue("a")], facets: emptyFacets() });
      }),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: a")).toBeTruthy());
    const box = view.getByRole("combobox", { name: "搜索错误问题" }) as HTMLInputElement;
    expect(box.value).toBe("is:resolved AND is:unassigned AND is:new");
    const sent = requests.at(-1);
    expect(sent?.get("q")).toBe("is:resolved AND is:unassigned AND is:new");
    expect(sent?.has("status")).toBe(false);
    expect(sent?.has("assignee")).toBe(false);
    expect(sent?.has("new")).toBe(false);
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

  it("searches Issue titles on the server and turns a legacy link into query text", async () => {
    useControlPlaneHandlers();
    window.history.replaceState({}, "", "/issues?search=checkout");
    const sent: Array<string | null> = [];
    server.use(
      http.get(`/api/v1/projects/${projectId}/issues`, ({ request }) => {
        const q = new URL(request.url).searchParams.get("q");
        sent.push(q);
        // The server reads is: conditions as status; only the words search the title.
        const words = (q ?? "")
          .split(/\s+/)
          .filter((word) => word && word !== "AND" && !word.startsWith("is:"));
        const issues = [issue("checkout"), issue("profile")].filter((candidate) =>
          words.every((word) => candidate.title.toLowerCase().includes(word.toLowerCase())),
        );
        return HttpResponse.json({ issues, facets: emptyFacets() });
      }),
    );
    const view = renderPage();
    await waitFor(() => expect(view.getByText("TypeError: checkout")).toBeTruthy());
    expect(view.queryByText("TypeError: profile")).toBeNull();
    // The old parameter is now visible, editable text beside the default status.
    const box = view.getByRole("combobox", { name: "搜索错误问题" }) as HTMLInputElement;
    expect(box.value).toBe("checkout AND is:unresolved");
    expect(sent).toContain("checkout AND is:unresolved");
    fireEvent.click(view.getByLabelText("清空查询"));
    await waitFor(() => expect(view.getByText("TypeError: profile")).toBeTruthy());
    fireEvent.change(box, { target: { value: "not-found" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(view.getByText("当前范围没有匹配的问题")).toBeTruthy());
    fireEvent.click(view.getByLabelText("清空查询"));
    await waitFor(() => expect(view.getByText("TypeError: profile")).toBeTruthy());
    const search = new URLSearchParams(window.location.search);
    expect(search.has("search")).toBe(false);
    expect(search.get("q")).toBe("");
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
    await waitFor(() => expect(view.getByText("没有匹配当前查询的问题")).toBeTruthy());
    fireEvent.click(view.getByText("下一页"));
    await waitFor(() => expect(view.getByText("TypeError: last")).toBeTruthy());
    fireEvent.click(view.getByText("上一页"));
    await waitFor(() => expect(view.getByText("没有匹配当前查询的问题")).toBeTruthy());
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
    const box = view.getByRole("combobox", { name: "搜索错误问题" }) as HTMLInputElement;
    expect(box.value).toBe("is:resolved AND browser:Safari");
    expect(view.queryByText("维度筛选")).toBeNull();
    // After a space, the caret starts a new condition and every field is offered.
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "is:resolved AND browser:Safari " } });
    expect(view.getByText("添加条件")).toBeTruthy();
    for (const label of ["问题状态", "错误标题", "Fingerprint", "用户 ID", "国家 / 地区"])
      expect(view.getAllByText(label, { exact: false }).length).toBeGreaterThan(0);
    fireEvent.click(view.getByLabelText("清空查询"));
    const search = new URLSearchParams(window.location.search);
    expect(search.get("environment")).toBe("production");
    expect(search.get("from")).toBe("2026-09-11T00:00:00.000Z");
    expect(search.has("status")).toBe(false);
    expect(search.has("browser")).toBe(false);
    expect(search.get("q")).toBe("");
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
