// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSessionTimeline, type EventDetail } from "@/lib/api/issues";
import { EventBreadcrumbs } from "./EventContext";

vi.mock("@/lib/api/issues", async (original) => ({
  ...(await original<typeof import("@/lib/api/issues")>()),
  getSessionTimeline: vi.fn(),
}));
afterEach(cleanup);

const event = {
  projectId: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  timestamp: "2026-10-02T03:35:38Z",
  breadcrumbs: [],
} as unknown as EventDetail;

const item = (eventId: string, kind: string, title: string) => ({
  eventId,
  kind,
  title,
  timestamp: "2026-10-02T03:35:00Z",
  attributes: {},
  measurements: {},
});

describe("EventBreadcrumbs", () => {
  it("leaves web vitals out of the behavior that led to the error", async () => {
    vi.mocked(getSessionTimeline).mockResolvedValue({
      events: [
        item("44444444-4444-4444-8444-444444444441", "page_view", "/checkout"),
        item("44444444-4444-4444-8444-444444444442", "web_vital", "LCP"),
        item("44444444-4444-4444-8444-444444444443", "click", "button#pay"),
      ],
      truncated: false,
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <EventBreadcrumbs event={event} />
      </QueryClientProvider>,
    );
    const list = await waitFor(() => view.getByRole("list", { name: "会话行为时间线" }));
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(list.querySelector('[data-kind="web_vital"]')).toBeNull();
  });
});
