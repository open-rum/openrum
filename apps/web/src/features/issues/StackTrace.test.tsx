// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EventDetail } from "@/lib/api/issues";
import { StackTrace } from "./StackTrace";

afterEach(cleanup);

function event(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    projectId: "project-1",
    eventId: "event-1",
    timestamp: "2026-09-30T00:00:00Z",
    receivedAt: "2026-09-30T00:00:01Z",
    environment: "production",
    release: "web@1.2.3",
    dist: "browser",
    sessionId: "s1",
    pageId: "p1",
    pageUrl: "https://example.com/checkout",
    errorType: "TypeError",
    errorMessage: "x is undefined",
    originalStack:
      "TypeError: x is undefined\n    at submit (https://cdn.example.com/assets/app.js:1:42)",
    fingerprint: "v1:checkout",
    fingerprintVersion: 1,
    ...overrides,
  } as EventDetail;
}

const failedStack: NonNullable<EventDetail["mappedStack"]> = {
  raw: "at submit (https://cdn.example.com/assets/app.js:1:42)",
  status: "partial",
  frames: [
    {
      function: "submit",
      url: "https://cdn.example.com/assets/app.js",
      line: 1,
      column: 42,
      original: { source: "src/checkout.ts", line: 10, column: 2 },
    },
    {
      function: "vendor",
      url: "https://cdn.example.com/assets/vendor.js",
      line: 1,
      column: 7,
      failure: "missing_artifact",
    },
  ],
};

describe("StackTrace source map guidance", () => {
  it("links to the Releases page with the event's release and dist preselected", () => {
    const view = render(<StackTrace event={event({ mappedStack: failedStack })} />);
    const note = view.getByRole("note", { name: "Source Map 下一步" });
    expect(within(note).getByText("为版本 web@1.2.3（dist browser）上传 Source Map")).toBeTruthy();
    expect(note.textContent).toContain("近 7 天内该版本的错误会自动重新还原");
    expect(
      within(note)
        .getByRole("link", { name: /上传 Source Map/ })
        .getAttribute("href"),
    ).toBe("/projects/project-1/releases?release=web%401.2.3&dist=browser");
  });

  it("shows each unmapped frame's own failure reason", () => {
    const view = render(<StackTrace event={event({ mappedStack: failedStack })} />);
    const frames = view.getByRole("list", { name: "映射后的调用帧" });
    expect(within(frames).getByText("没有找到与脚本地址匹配的 Source Map")).toBeTruthy();
    expect(
      within(frames).getByText("没有找到与脚本地址匹配的 Source Map").closest("li")?.title,
    ).toBe("没有找到与脚本地址匹配的 Source Map");
  });

  it("tells the user to set release in the SDK when the event has none", () => {
    const view = render(
      <StackTrace
        event={event({
          release: undefined,
          mappedStack: { ...failedStack, status: "failed", failure: "missing_release" },
        })}
      />,
    );
    const note = view.getByRole("note", { name: "Source Map 下一步" });
    expect(within(note).getByText("事件没有 release，无法匹配 Source Map")).toBeTruthy();
    expect(note.textContent).toContain("release");
    expect(within(note).queryByRole("link", { name: /上传 Source Map/ })).toBeNull();
  });

  it("guides events that have a stack but no mapping result yet", () => {
    const view = render(<StackTrace event={event({ mappedStack: undefined, dist: undefined })} />);
    const note = view.getByRole("note", { name: "Source Map 下一步" });
    expect(within(note).getByText("为版本 web@1.2.3 上传 Source Map")).toBeTruthy();
    expect(within(note).getByRole("link").getAttribute("href")).toBe(
      "/projects/project-1/releases?release=web%401.2.3",
    );
  });

  it("stays quiet when the stack is fully mapped", () => {
    const view = render(
      <StackTrace
        event={event({
          mappedStack: { ...failedStack, status: "mapped", frames: [failedStack.frames[0]] },
        })}
      />,
    );
    expect(view.queryByRole("note", { name: "Source Map 下一步" })).toBeNull();
  });
});
