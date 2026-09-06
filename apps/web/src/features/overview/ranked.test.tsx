// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { OverviewResponse } from "@/lib/api/client";
import { defaultOverviewFilters } from "@/lib/filters/schema";
import { SlowApis } from "./SlowApis";
import { TopIssues } from "./TopIssues";
import { QualityTrend } from "./QualityTrend";

const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
afterEach(cleanup);

describe("overview ranked tables", () => {
  it("keeps filters in issue drill-down and supports keyboard focus", async () => {
    const filters = defaultOverviewFilters(projectId, new Date("2026-09-02T00:00:00Z"));
    filters.environment = "production";
    const view = render(
      <TopIssues
        filters={filters}
        issues={[
          {
            fingerprint: "fp:v1:abc",
            title: "TypeError: price is undefined",
            events: 14,
            users: 9,
            lastSeenAt: "2026-09-01T23:59:00Z",
          },
        ]}
      />,
    );
    await userEvent.tab();
    const link = view.getByRole("link", { name: "TypeError: price is undefined" });
    expect(document.activeElement).toBe(link);
    expect(link.getAttribute("href")).toContain("environment=production");
    expect(link.getAttribute("href")).toContain(`/projects/${projectId}/issues/fp%3Av1%3Aabc?`);
  });

  it("builds a stable API detail URL", () => {
    const filters = defaultOverviewFilters(projectId, new Date("2026-09-02T00:00:00Z"));
    const api: OverviewResponse["slowApis"][number] = {
      method: "POST",
      url: "https://shop.example.com/api/order",
      requests: 120,
      failures: 3,
      failureRate: 0.025,
      durationP95: 820,
    };
    const view = render(<SlowApis filters={filters} apis={[api]} />);
    const link = view.getByRole("link", { name: /POST/ });
    expect(link.getAttribute("href")).toContain("method=POST");
    expect(link.getAttribute("href")).toContain("url=https%3A%2F%2Fshop.example.com%2Fapi%2Forder");
    expect(view.container.textContent).toContain("820ms");
  });

  it("provides a table summary for chart data", () => {
    const metric = { value: 12, samples: 10 };
    const rate = {
      value: 0.02,
      numerator: 1,
      denominator: 12,
      numeratorSamples: 1,
      denominatorSamples: 10,
    };
    const html = renderToStaticMarkup(
      <QualityTrend
        data={
          {
            series: [
              {
                bucket: "2026-09-02T00:00:00Z",
                pageViews: metric,
                uniqueUsers: { ...metric, approximate: true },
                errorRate: rate,
              },
            ],
          } as OverviewResponse
        }
      />,
    );
    expect(html).toContain("查看趋势表格数据");
    expect(html).toContain("2.00%");
  });
});
