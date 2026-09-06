// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { APIsResponse } from "@/lib/api/apis";
import { ApiScatter } from "./ApiScatter";
import { ApiTimeSpent } from "./ApiTimeSpent";

afterEach(cleanup);

type Endpoint = APIsResponse["endpoints"][number];

function endpoint(overrides: Partial<Endpoint>): Endpoint {
  return {
    method: "GET",
    url: "https://api.example/items",
    requests: 1000,
    estimated: 1000,
    failures: 0,
    clientErrors: 0,
    serverErrors: 0,
    networkErrors: 0,
    p50: 80,
    p75: 120,
    p95: 200,
    sufficient: true,
    ...overrides,
  };
}

// A busy fast endpoint against a rare slow one: the pair the page cannot rank
// with a single sorted column.
const busy = endpoint({
  url: "https://api.example/feed",
  estimated: 400_000,
  p95: 200,
});
const rareAndSlow = endpoint({
  method: "DELETE",
  url: "https://api.example/carts/:id",
  requests: 20,
  estimated: 90,
  failures: 5,
  serverErrors: 5,
  p95: 4200,
  sufficient: false,
});

describe("ApiTimeSpent", () => {
  it("ranks by volume weight so the slowest endpoint does not lead by default", () => {
    render(<ApiTimeSpent endpoints={[rareAndSlow, busy]} onSelect={vi.fn()} />);

    // 400000 x 200 dwarfs 90 x 4200, so the fast endpoint carries the time.
    expect(screen.getByText(/占当前范围总耗时的 99\.5%/)).toBeTruthy();
    expect(screen.getByText("GET https://api.example/feed")).toBeTruthy();
  });

  it("reports an empty range rather than an axis with no bars", () => {
    render(<ApiTimeSpent endpoints={[endpoint({ p95: null })]} onSelect={vi.fn()} />);

    expect(screen.getByText("当前范围没有可比较的 endpoint。")).toBeTruthy();
  });
});

describe("ApiScatter", () => {
  it("plots each comparable endpoint against the overall P95", () => {
    render(<ApiScatter endpoints={[busy, rareAndSlow]} overallP95={240} onSelect={vi.fn()} />);

    expect(screen.getByRole("img", { name: "endpoint 请求量与 P95 延迟分布" })).toBeTruthy();
  });

  it("drops endpoints a log scale cannot place", () => {
    render(
      <ApiScatter
        endpoints={[endpoint({ estimated: 0 }), endpoint({ p95: null })]}
        overallP95={240}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("当前范围没有可比较的 endpoint。")).toBeTruthy();
  });
});
