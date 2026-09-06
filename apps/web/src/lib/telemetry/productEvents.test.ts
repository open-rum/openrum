// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { magicMomentDuration, readProductEvents, recordProductEvent } from "./productEvents";

describe("product event timeline", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("records each project milestone once without making a network request", () => {
    const fetchSpy = vi.spyOn(window, "fetch");
    const projectId = "project-1";
    recordProductEvent("project_created", projectId, new Date("2026-09-03T00:00:00Z"));
    recordProductEvent("project_created", projectId, new Date("2026-09-03T00:00:01Z"));
    recordProductEvent("first_event_queryable", projectId, new Date("2026-09-03T00:00:20Z"));
    recordProductEvent("overview_viewed", projectId, new Date("2026-09-03T00:00:30Z"));

    expect(readProductEvents().map((event) => event.name)).toEqual([
      "project_created",
      "first_event_queryable",
      "overview_viewed",
    ]);
    expect(magicMomentDuration(projectId)).toBe(30_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
