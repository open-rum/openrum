// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
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
});

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
