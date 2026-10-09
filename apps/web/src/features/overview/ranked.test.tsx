// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { defaultOverviewFilters } from "@/lib/filters/schema";
import { TopIssues } from "./TopIssues";

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
});
