import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/api/projects";
import type { UsageResponse } from "@/lib/api/usage";
import { emptyTotals, projectUsageLink, readUsageRange, summarizeUsage } from "./organizationUsage";

const range = { from: new Date("2026-09-20T00:00:00Z"), to: new Date("2026-09-20T03:00:00Z") };
const project = { id: "project" } as Project;
const usage: UsageResponse = {
  from: range.from.toISOString(),
  to: range.to.toISOString(),
  intervalSeconds: 3600,
  totals: { ...emptyTotals(), accepted: 20, rejected: 3 },
  breakdown: [
    {
      bucket: "2026-09-20T01:00:00Z",
      eventType: "error",
      outcome: "accepted",
      reason: "",
      events: 20,
      estimated: 20,
      bytes: 100,
    },
  ],
};
describe("organization usage summaries", () => {
  it("retains complete totals, flags failed projects and pads missing time buckets", () => {
    const summary = summarizeUsage(
      [
        { project, usage },
        { project, unavailable: true },
      ],
      range,
    );
    expect(summary.totals.accepted).toBe(20);
    expect(summary.totals.rejected).toBe(3);
    expect(summary.unavailable).toBe(1);
    expect(summary.series.map((row) => row.accepted)).toEqual([0, 20, 0]);
  });
  it("marks capped breakdowns incomplete without replacing full totals", () => {
    const summary = summarizeUsage(
      [
        {
          project,
          usage: { ...usage, breakdown: Array.from({ length: 5000 }, () => usage.breakdown[0]) },
        },
      ],
      range,
    );
    expect(summary.truncated).toBe(true);
    expect(summary.totals.accepted).toBe(20);
  });
  it("preserves time and event type in deep links and rejects invalid ranges", () => {
    const url = new URL(
      projectUsageLink(project.id, { ...range, eventType: "error" }),
      "https://example.com",
    );
    expect(url.pathname).toBe(`/settings/project/${project.id}/usage`);
    expect(readUsageRange(url.searchParams, range)).toEqual({ ...range, eventType: "error" });
    expect(readUsageRange(new URLSearchParams("from=bad&to=bad&eventType=unknown"), range)).toEqual(
      { ...range, eventType: undefined },
    );
    expect(
      readUsageRange(new URLSearchParams("from=2025-01-01&to=2026-01-01"), range).from,
    ).toEqual(range.from);
  });
});
