import { describe, expect, it } from "vitest";
import { projectSwitchDestination } from "./projectSwitchDestination";

describe("project switching context", () => {
  it("keeps shared context and resets detail IDs and page-specific filters", () => {
    expect(
      projectSwitchDestination(
        "next",
        "/projects/current/sessions/secret-session",
        "?from=start&to=end&environment=staging&timePreset=7d&q=user&preview=secret-session&cursor=next",
      ),
    ).toEqual({
      to: "/projects/next/sessions",
      search: { from: "start", to: "end", environment: "staging", timePreset: "7d" },
    });
    expect(
      projectSwitchDestination(
        "next",
        "/projects/current/analytics/funnels",
        "?environment=production",
      ),
    ).toEqual({
      to: "/projects/next/analytics/funnels",
      search: { environment: "production" },
    });
  });
  it("keeps supported settings pages and falls back to the overview elsewhere", () => {
    expect(projectSwitchDestination("next", "/projects/current/alerts", "?rule=old-rule")).toEqual({
      to: "/projects/next/alerts",
      search: {},
    });
    expect(
      projectSwitchDestination("next", "/settings/project/current/api-capture", "?q=secret"),
    ).toEqual({ to: "/settings/project/next/api-capture", search: {} });
    expect(projectSwitchDestination("next", "/settings/account", "")).toEqual({
      to: "/projects/next/overview",
      search: {},
    });
  });
});
