// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getOverview } from "@/lib/api/client";
import { defaultOverviewFilters } from "@/lib/filters/schema";

const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("overview API client", () => {
  it("preserves a bounded API error from MSW", async () => {
    server.use(
      http.get(`/api/v1/projects/${projectId}/overview`, () =>
        HttpResponse.json(
          { error: { code: "QUERY_TOO_EXPENSIVE", message: "narrow it", requestId: "req-1" } },
          { status: 422 },
        ),
      ),
    );
    await expect(
      getOverview(defaultOverviewFilters(projectId, new Date("2026-09-02T00:00:00Z"))),
    ).rejects.toMatchObject({ status: 422, code: "QUERY_TOO_EXPENSIVE", requestId: "req-1" });
  });
});
