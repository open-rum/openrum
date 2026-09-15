// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { SessionSummary } from "@/lib/api/sessions";
import {
  sessionDetailHrefFromList,
  sessionListReturnHref,
  subscribeSessionLocation,
  updateSessionDetailSearch,
} from "./sessionNavigation";

it("notifies React subscribers when timeline filters change", () => {
  window.history.replaceState({}, "", "/projects/p/sessions/s?from=a&to=b&event=old");
  const listener = vi.fn();
  const unsubscribe = subscribeSessionLocation(listener);

  updateSessionDetailSearch({ types: "page,error", event: undefined });

  expect(window.location.search).toContain("types=page%2Cerror");
  expect(window.location.search).not.toContain("event=");
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
});

it("carries the list state into detail and returns to the exact list", () => {
  window.history.replaceState(
    {},
    "",
    "/projects/p/sessions?from=2026-09-01&to=2026-09-02&search=alice&preview=session-1",
  );
  const session = {
    sessionId: "session-1",
    startedAt: "2026-09-01T10:00:00.000Z",
    endedAt: "2026-09-01T10:10:00.000Z",
  } as SessionSummary;

  const detail = new URL(sessionDetailHrefFromList("p", session), window.location.origin);
  expect(detail.searchParams.get("returnTo")).toBe(
    "/projects/p/sessions?from=2026-09-01&to=2026-09-02&search=alice",
  );
  expect(
    sessionListReturnHref(
      "p",
      detail.searchParams,
      new Date(session.startedAt),
      new Date(session.endedAt),
    ),
  ).toBe("/projects/p/sessions?from=2026-09-01&to=2026-09-02&search=alice");
});

it("rejects an external return target", () => {
  const search = new URLSearchParams({ returnTo: "https://example.com/steal" });
  const href = sessionListReturnHref(
    "p",
    search,
    new Date("2026-09-01T10:00:00.000Z"),
    new Date("2026-09-01T10:10:00.000Z"),
  );
  expect(href).toBe(
    "/projects/p/sessions?from=2026-09-01T10%3A00%3A00.000Z&to=2026-09-01T10%3A10%3A00.000Z",
  );
});
