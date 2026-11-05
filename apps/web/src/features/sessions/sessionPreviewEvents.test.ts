import { describe, expect, it } from "vitest";
import type { SessionTimelineEvent } from "@/lib/api/sessions";
import { sessionPreviewEvents } from "./sessionPreviewEvents";

const event = (
  kind: SessionTimelineEvent["kind"],
  id: number,
  extra = {},
): SessionTimelineEvent => ({
  eventId: String(id),
  kind,
  timestamp: "2026-11-05T00:00:00Z",
  title: kind,
  attributes: {},
  ...extra,
});
describe("session preview selection", () => {
  it("shows later navigation instead of letting performance metrics consume the preview", () => {
    const events = [
      event("page_view", 0),
      ...Array.from({ length: 8 }, (_, i) => event("web_vital", i + 1)),
      event("navigation", 9),
      event("click", 10),
    ];
    expect(sessionPreviewEvents(events).map((item) => item.eventId)).toEqual(["0", "9", "10"]);
  });
  it("prioritizes failures within the six-item budget and keeps chronological order", () => {
    const events = [
      ...Array.from({ length: 8 }, (_, i) => event("navigation", i)),
      event("api", 8, { apiStatus: 500 }),
      event("error", 9),
    ];
    expect(sessionPreviewEvents(events).map((item) => item.eventId)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "8",
      "9",
    ]);
  });
  it("still shows available evidence when only performance events remain", () => {
    expect(
      sessionPreviewEvents(Array.from({ length: 8 }, (_, i) => event("web_vital", i))),
    ).toHaveLength(6);
  });
});
