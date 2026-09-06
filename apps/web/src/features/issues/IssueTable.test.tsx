// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
    filters.status = "unresolved";
    filters.sort = "users";
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
    expect(view.getByText("待处理")).toBeTruthy();
    expect(view.getByText("已解决")).toBeTruthy();
    expect(view.getByText("已忽略")).toBeTruthy();
    const rows = view.container.querySelectorAll<HTMLTableRowElement>("[data-issue-row]");
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[0].querySelector("a")?.getAttribute("href")).toContain("sort=events");
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
  };
}
