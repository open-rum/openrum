import { describe, expect, it } from "vitest";
import { isAnalysisRoute } from "./AnalysisContextBar";

describe("isAnalysisRoute", () => {
  it("keeps the time range on named dashboards as well as the bare overview", () => {
    expect(isAnalysisRoute("/projects/p1/overview")).toBe(true);
    expect(isAnalysisRoute("/projects/p1/overview/0190-dashboard")).toBe(true);
    expect(isAnalysisRoute("/projects/p1/overview/a/b")).toBe(false);
    expect(isAnalysisRoute("/settings/project/p1/general")).toBe(false);
  });
});
