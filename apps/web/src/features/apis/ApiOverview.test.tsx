// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiOverview } from "./ApiOverview";

vi.mock("./ApiCharts", () => ({ ApiCharts: () => <div>请求趋势图</div> }));
afterEach(cleanup);
const summary = { requests: 0, estimated: 0, failures: 0, clientErrors: 0, serverErrors: 0, networkErrors: 0, p50: null, p75: null, p95: null, endpoints: 0 };
const range = { from: "2026-11-04T00:00:00Z", to: "2026-11-05T00:00:00Z", interval: "1 HOUR" };
describe("API empty sample semantics", () => {
  it("does not present no traffic as a healthy zero failure rate or empty charts", () => {
    const view = render(<ApiOverview summary={summary} previous={summary} trend={[]} range={range} />);
    expect(view.getByText("暂无请求样本，无法计算失败率")).toBeTruthy();
    expect(view.queryByText("0.00%")).toBeNull();
    expect(view.queryByText(/pp/)).toBeNull();
    expect(view.queryByText("请求趋势图")).toBeNull();
  });
  it("still shows a measured zero failure rate when requests were observed", () => {
    const view = render(<ApiOverview summary={{ ...summary, requests: 10, estimated: 10 }} previous={summary} trend={[]} range={range} />);
    expect(view.getByText("0.00%")).toBeTruthy();
    expect(view.getByText("请求趋势图")).toBeTruthy();
    expect(view.queryByText(/pp/)).toBeNull();
  });
});
