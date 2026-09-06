// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getOverview, type OverviewResponse } from "@/lib/api/client";
import { defaultOverviewFilters } from "@/lib/filters/schema";
import { FreshnessBanner } from "./FreshnessBanner";
import { MetricCards } from "./MetricCards";
import { isOverviewEmpty } from "./state";

const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("overview states", () => {
  it("keeps stable loading dimensions", () => {
    const view = render(<MetricCards loading />);
    expect(view.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(7);
  });

  it("shows populated denominators and low-sample vitals", () => {
    const view = render(<MetricCards data={fixture()} />);
    expect(view.container.textContent).toContain("3 错误 / 120 PV");
    expect(view.container.textContent).toContain("API 失败率");
    expect(view.container.textContent?.match(/样本不足/g)).toHaveLength(3);
  });

  it("distinguishes empty and stale data", () => {
    const empty = fixture();
    empty.kpis.pageViews.samples = 0;
    empty.kpis.errorRate.numeratorSamples = 0;
    empty.kpis.apiFailureRate.denominatorSamples = 0;
    expect(isOverviewEmpty(empty)).toBe(true);
    const view = render(
      <FreshnessBanner
        freshness={{ latestReceivedAt: "2026-09-02T00:00:00Z", ageSeconds: 601, stale: true }}
      />,
    );
    expect(view.container.textContent).toContain("数据延迟 10 分钟");
    expect(view.container.textContent).toContain("不要将其视为实时状态");
  });

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

function fixture(): OverviewResponse {
  const count = { value: 120, samples: 100 };
  const cardinality = { value: 80, samples: 100, approximate: true };
  const rate = {
    value: 0.025,
    numerator: 3,
    denominator: 120,
    numeratorSamples: 3,
    denominatorSamples: 100,
  };
  const vital = { p75: 1200, samples: 12, sufficient: false };
  const kpis = {
    pageViews: count,
    uniqueUsers: cardinality,
    errorRate: rate,
    apiFailureRate: rate,
    lcp: vital,
    inp: vital,
    cls: { ...vital, p75: 0.12 },
  };
  return {
    from: "2026-09-01T00:00:00Z",
    to: "2026-09-02T00:00:00Z",
    intervalSeconds: 300,
    kpis,
    comparison: {
      from: "2026-08-31T00:00:00Z",
      to: "2026-09-01T00:00:00Z",
      previous: kpis,
      changes: {
        pageViewsPercent: 2,
        uniqueUsersPercent: 1,
        errorRatePoints: 0.1,
        apiFailureRatePoints: -0.1,
        lcpPercent: 3,
        inpPercent: 2,
        clsPercent: 1,
      },
    },
    series: [],
    topIssues: [],
    slowApis: [],
    freshness: { latestReceivedAt: "2026-09-01T23:59:50Z", ageSeconds: 10, stale: false },
  };
}
