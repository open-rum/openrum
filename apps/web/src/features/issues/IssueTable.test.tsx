// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultIssueFilters,
  parseIssueFilters,
  serializeIssueFilters,
  type IssuesResponse,
} from "@/lib/api/issues";
import { IssueTable } from "./IssueTable";

const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
afterEach(cleanup);

describe("issues list", () => {
  it("round-trips filters and safely drops an invalid cursor", () => {
    const filters = defaultIssueFilters(projectId, new Date("2026-09-03T12:00:00Z"));
    filters.browser = "Chrome";
    filters.country = "CN";
    filters.title = "checkout failed";
    filters.errorType = "TypeError";
    filters.fingerprint = "v1:checkout";
    filters.userId = "customer-123";
    filters.status = "unresolved";
    filters.sort = "users";
    filters.assignee = "none";
    filters.newOnly = true;
    const restored = parseIssueFilters(projectId, serializeIssueFilters(filters));
    expect(restored).toEqual(filters);
    const invalid = serializeIssueFilters(filters);
    invalid.set("cursor", "../bad");
    expect(parseIssueFilters(projectId, invalid).cursor).toBeUndefined();
  });

  it("renders all states and supports arrow-key row navigation", () => {
    const filters = defaultIssueFilters(projectId, new Date("2026-09-03T12:00:00Z"));
    const issues = ["unresolved", "resolved", "ignored"].map((status, index) =>
      issueFixture(status as IssuesResponse["issues"][number]["status"], index),
    );
    const view = render(<IssueTable issues={issues} filters={filters} />);
    // Unresolved is the default, so only the other states are spelled out.
    expect(view.queryByText("待处理")).toBeNull();
    expect(view.getByText("已解决")).toBeTruthy();
    expect(view.getByText("已忽略")).toBeTruthy();
    const rows = view.container.querySelectorAll<HTMLTableRowElement>("[data-issue-row]");
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[0].querySelector("a")?.getAttribute("href")).toContain("sort=events");
  });

  it("sorts from the column headers and marks the active one", () => {
    const filters = defaultIssueFilters(projectId, new Date("2026-09-03T12:00:00Z"));
    const onSortChange = vi.fn();
    const view = render(
      <IssueTable
        issues={[issueFixture("unresolved", 0)]}
        filters={filters}
        onSortChange={onSortChange}
      />,
    );
    expect(view.getByText("事件").closest("th")?.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(view.getByRole("button", { name: /用户/ }));
    fireEvent.click(view.getByRole("button", { name: /最近发生/ }));
    expect(onSortChange.mock.calls).toEqual([["users"], ["last_seen"]]);
  });

  it("labels a regression and keeps its trend in the active colour", () => {
    const filters = defaultIssueFilters(projectId, new Date("2026-09-03T12:00:00Z"));
    const view = render(<IssueTable issues={[issueFixture("regressed", 0)]} filters={filters} />);
    expect(view.getByText("已回归")).toBeTruthy();
  });

  it("selects rows without opening them", () => {
    const filters = defaultIssueFilters(projectId, new Date("2026-09-03T12:00:00Z"));
    const onChange = vi.fn();
    const issues = [issueFixture("unresolved", 0), issueFixture("unresolved", 1)];
    const view = render(
      <IssueTable
        issues={issues}
        filters={filters}
        selection={{ selected: new Set(["v1:issue-1"]), onChange }}
      />,
    );
    const header = view.getByRole("checkbox", { name: "选择本页全部问题" });
    expect(header.getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(view.getByRole("checkbox", { name: "选择问题：TypeError: fixture 0" }));
    expect([...(onChange.mock.calls[0][0] as Set<string>)].sort()).toEqual([
      "v1:issue-0",
      "v1:issue-1",
    ]);
    fireEvent.click(header);
    expect(onChange.mock.calls[1][0].size).toBe(2);
    expect(view.container.querySelectorAll("[data-selected]")).toHaveLength(1);
  });

  it("shows the culprit line and a trend sparkline, without a first-seen column", () => {
    const filters = defaultIssueFilters(projectId, new Date("2026-09-03T12:00:00Z"));
    const view = render(<IssueTable issues={[issueFixture("unresolved", 0)]} filters={filters} />);
    const row = view.container.querySelector("[data-issue-row]");
    expect(row?.textContent).toContain("TypeError · submit · assets/app.js");
    expect(row?.querySelector("svg")).toBeTruthy();
    expect(view.queryByText("首次发生")).toBeNull();
    expect(view.getByText("趋势")).toBeTruthy();
  });

  it("marks only Issues first seen inside the range as new", () => {
    const filters = defaultIssueFilters(projectId, new Date("2026-09-03T12:00:00Z"));
    const recurring = { ...issueFixture("unresolved", 1), firstSeenAt: "2026-08-20T10:00:00Z" };
    const view = render(
      <IssueTable issues={[issueFixture("unresolved", 0), recurring]} filters={filters} />,
    );
    const rows = view.container.querySelectorAll("[data-issue-row]");
    expect(rows[0].textContent).toContain("新");
    expect(rows[1].textContent).not.toContain("新");
  });
});

function issueFixture(
  status: IssuesResponse["issues"][number]["status"],
  index: number,
): IssuesResponse["issues"][number] {
  return {
    fingerprint: `v1:issue-${index}`,
    fingerprintVersion: 1,
    title: `TypeError: fixture ${index}`,
    errorType: "TypeError",
    events: 20 - index,
    users: 10 - index,
    sessions: 12 - index,
    firstSeenAt: "2026-09-03T10:00:00Z",
    lastSeenAt: "2026-09-03T11:00:00Z",
    status,
    assigneeUserId: null,
    resolvedInReleaseId: null,
    trend: [0, 2, 5, 3, 8],
    culprit: { function: "submit", file: "assets/app.js" },
  };
}
