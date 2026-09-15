import { describe, expect, it } from "vitest";
import { sessionDetailHref, sessionEventHref, sessionRange, type SessionSummary } from "./sessions";

const session: SessionSummary = {
  sessionId: "018f4d9c-83a1-76c9-81c2-3020ab660001",
  visitorId: "visitor-1",
  startedAt: "2026-09-12T00:00:00.000Z",
  endedAt: "2026-09-12T00:30:00.000Z",
  durationSeconds: 1800,
  events: 220,
  pageViews: 4,
  errors: 1,
  apiFailures: 2,
  customEvents: 10,
  slowestApiMs: 900,
};

describe("session detail links", () => {
  it("locks a list link to the exact session range", () => {
    const href = new URL(sessionDetailHref("project-1", session), "https://openrum.local");
    expect(href.pathname).toBe(`/projects/project-1/sessions/${session.sessionId}`);
    expect(href.searchParams.get("from")).toBe(session.startedAt);
    expect(href.searchParams.get("to")).toBe("2026-09-12T00:30:00.001Z");
  });

  it("keeps event deep links within the 24 hour API boundary", () => {
    const href = new URL(
      sessionEventHref("project-1", session.sessionId, "2026-09-12T12:00:00.000Z", "event-1"),
      "https://openrum.local",
    );
    expect(
      new Date(href.searchParams.get("to")!).getTime() -
        new Date(href.searchParams.get("from")!).getTime(),
    ).toBe(86_400_000);
    expect(href.searchParams.get("event")).toBe("event-1");
  });

  it("never expands a 24 hour session past the backend limit", () => {
    const range = sessionRange({ ...session, endedAt: "2026-09-13T00:00:00.000Z" });
    expect(range.to.getTime() - range.from.getTime()).toBe(86_400_000);
  });
});
