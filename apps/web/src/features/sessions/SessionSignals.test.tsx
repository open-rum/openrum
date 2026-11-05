// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionSignals } from "./SessionSignals";
afterEach(cleanup);
describe("session signals", () => {
  it("shows a slow LCP independently of the absence of errors", () => {
    const view = render(<SessionSignals session={{ errors: 0, apiFailures: 0, lcp: 7070 }} />);
    expect(view.getByText("无错误/API 失败")).toBeTruthy();
    expect(view.getByText("LCP 较差")).toBeTruthy();
    expect(view.queryByText("正常")).toBeNull();
  });
  it("uses shared LCP thresholds and keeps missing performance unknown", () => {
    const view = render(<SessionSignals session={{ errors: 1, apiFailures: 0, lcp: 3000 }} />);
    expect(view.getByText("LCP 待优化")).toBeTruthy();
    expect(view.getByText("1 错误")).toBeTruthy();
    view.rerender(<SessionSignals session={{ errors: 0, apiFailures: 0 }} />);
    expect(view.queryByText(/LCP/)).toBeNull();
  });
});
