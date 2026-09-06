// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BehaviorTimeline } from "./BehaviorTimeline";
import { parseBehaviorTimelineItem, sessionTimelineRange } from "./timeline";

describe("behavior timeline", () => {
  it("renders navigation context as a readable action", () => {
    expect(
      parseBehaviorTimelineItem(
        JSON.stringify({
          timestamp: "2026-09-03T09:00:00Z",
          category: "navigation",
          message: "route_change",
          data: { route: "/checkout" },
        }),
      ),
    ).toMatchObject({
      category: "navigation",
      title: "页面导航",
      description: "切换前端路由：/checkout",
    });
  });

  it("uses only sanitized click metadata supplied by the event", () => {
    const item = parseBehaviorTimelineItem(
      JSON.stringify({
        category: "ui.click",
        message: "ui.click",
        data: { element: "button", name: "checkout.submit" },
      }),
    );
    expect(item.description).toBe("点击 checkout.submit");
    expect(item.metadata).toEqual([
      ["element", "button"],
      ["name", "checkout.submit"],
    ]);
  });

  it("keeps malformed legacy breadcrumbs readable", () => {
    expect(parseBehaviorTimelineItem("click:button#pay")).toMatchObject({
      category: "other",
      title: "用户行为",
      description: "click:button#pay",
    });
  });

  it("marks the selected event in a complete session timeline", () => {
    const view = render(
      <BehaviorTimeline
        breadcrumbs={[]}
        anchorEventId="018f4d9c-83a1-76c9-81c2-3020ab660002"
        sessionTimeline={{
          projectId: "018f4d9c-83a1-76c9-81c2-3020ab660000",
          sessionId: "018f4d9c-83a1-76c9-81c2-3020ab660001",
          from: "2026-09-03T00:00:00Z",
          to: "2026-09-04T00:00:00Z",
          truncated: false,
          events: [
            {
              eventId: "018f4d9c-83a1-76c9-81c2-3020ab660002",
              timestamp: "2026-09-03T09:00:00Z",
              kind: "custom",
              title: "checkout_started",
              attributes: {},
            },
          ],
        }}
      />,
    );
    expect(view.getByText("当前事件").closest("li")?.getAttribute("aria-current")).toBe("true");
  });

  it("builds a bounded 24-hour timeline window around an event", () => {
    const range = sessionTimelineRange("2026-09-03T12:00:00Z");
    expect(range.from.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-04T00:00:00.000Z");
  });
});
