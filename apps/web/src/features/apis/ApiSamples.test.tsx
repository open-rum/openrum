// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAPISamples, type APIFilters, type APISample } from "@/lib/api/apis";
import { ApiSamples } from "./ApiSamples";

vi.mock("@/lib/api/apis", async (original) => ({
  ...(await original<typeof import("@/lib/api/apis")>()),
  getAPISamples: vi.fn(),
}));

const fetchSamples = vi.mocked(getAPISamples);
const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
const filters: APIFilters = {
  projectId,
  from: new Date("2026-10-12T10:00:00Z"),
  to: new Date("2026-10-12T12:00:00Z"),
  methods: [],
  method: "GET",
  url: "https://shop.example.com/api/payment-methods",
  sort: "requests",
};
const endpoint = { p50: 100, p75: 200, p95: 400 };

const sample = (overrides: Partial<APISample> = {}): APISample => ({
  eventId: "018f4d9c-83a1-76c9-81c2-3020ab660001",
  timestamp: "2026-10-12T11:07:34.000Z",
  method: "GET",
  url: "https://shop.example.com/api/payment-methods",
  status: 200,
  durationMs: 250,
  transferSize: 193,
  route: "/third-pay/checkout",
  pageUrl: "https://shop.example.com/third-pay/checkout",
  environment: "prod",
  release: "2.18.0",
  browser: "Mobile Safari",
  browserVersion: "26.6.1",
  os: "iOS",
  osVersion: "18.7",
  deviceType: "mobile",
  country: "TH",
  sessionId: "018f4d9c-83a1-76c9-81c2-3020ab66aaaa",
  anonymousUserId: "uid_qdp44uuk40clowwi",
  userId: "1435448070",
  ...overrides,
});

const first = sample();
const second = sample({
  eventId: "018f4d9c-83a1-76c9-81c2-3020ab660002",
  timestamp: "2026-10-12T11:05:00.000Z",
  status: 503,
  failure: "http",
  durationMs: 900,
  anonymousUserId: "uid_other",
  userId: undefined,
  attributes: { plan: "pro", experiment: "b" },
});

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiSamples filters={filters} endpoint={endpoint} projectId={projectId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchSamples.mockReset();
  fetchSamples.mockResolvedValue({ samples: [first, second], truncated: false });
});
afterEach(cleanup);

describe("ApiSamples", () => {
  it("lists the requests and opens the first one", async () => {
    mount();
    const list = within(await screen.findByRole("list", { name: "请求列表" }));
    expect(list.getAllByRole("button")).toHaveLength(2);
    expect(list.getAllByRole("button")[0].getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { name: "基础信息" })).toBeTruthy();
    expect(screen.getByText("/third-pay/checkout", { selector: "code" })).toBeTruthy();
  });

  it("shows what the SDK reported about the selected request", async () => {
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    // Status, size and load state are said once, in the summary above the cards.
    const summary = within(screen.getByRole("list", { name: "请求概览" }));
    expect(summary.getByText("成功")).toBeTruthy();
    expect(summary.getByText("200")).toBeTruthy();
    expect(summary.getByText("193 B")).toBeTruthy();
    const facts = within(screen.getByRole("heading", { name: "基础信息" }).closest("section")!);
    expect(facts.queryByText("加载状态")).toBeNull();
    expect(facts.queryByText("状态码")).toBeNull();
    expect(facts.queryByText("资源大小")).toBeNull();
    expect(facts.queryByText("错误信息")).toBeNull();
    expect(facts.getByText("iOS (18.7)")).toBeTruthy();
    expect(facts.getByText("Mobile Safari (26.6.1)")).toBeTruthy();
    expect(facts.getByText("mobile")).toBeTruthy();
    expect(facts.getByText("uid_qdp44uuk40clowwi")).toBeTruthy();
    expect(facts.getByText("1435448070")).toBeTruthy();
    expect(facts.getByText("泰国 (TH)")).toBeTruthy();
    expect(facts.getByText("prod")).toBeTruthy();
    // Fields the SDK never reports are left out rather than shown empty.
    expect(facts.queryByText("客户端 IP 地址")).toBeNull();
    expect(facts.queryByText("省份")).toBeNull();
    expect(facts.queryByText("运营商名称")).toBeNull();
  });

  it("opens another request, with its failure and its custom attributes", async () => {
    mount();
    const list = within(await screen.findByRole("list", { name: "请求列表" }));
    fireEvent.click(list.getAllByRole("button")[1]);
    expect(list.getAllByRole("button")[1].getAttribute("aria-current")).toBe("true");
    const summary = within(screen.getByRole("list", { name: "请求概览" }));
    expect(summary.getByText("服务端错误")).toBeTruthy();
    const facts = within(screen.getByRole("heading", { name: "基础信息" }).closest("section")!);
    expect(facts.getByText("服务端返回错误")).toBeTruthy();
    const extra = within(screen.getByRole("heading", { name: "附加信息" }).closest("section")!);
    expect(extra.getByText("plan")).toBeTruthy();
    expect(extra.getByText("pro")).toBeTruthy();
  });

  it("says so when a request has no custom attributes", async () => {
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    await userEvent.click(screen.getByRole("tab", { name: "自定义属性" }));
    expect(screen.getByText(/没有自定义属性/)).toBeTruthy();
  });

  it("places the request's time among the endpoint's percentiles", async () => {
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    const timing = within(screen.getByRole("heading", { name: "耗时" }).closest("section")!);
    expect(timing.getByText("250 ms")).toBeTruthy();
    expect(timing.getByRole("img", { name: /P50、P75、P95/ })).toBeTruthy();
    expect(timing.queryByText("慢于该 endpoint 的 P95")).toBeNull();
    expect(timing.getByText(/阶段耗时/)).toBeTruthy();
  });

  it("links the session with the request anchored", async () => {
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    const link = screen.getByRole("link", { name: "查看会话" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("/sessions/018f4d9c-83a1-76c9-81c2-3020ab66aaaa?");
    expect(link.getAttribute("href")).toContain("event=018f4d9c-83a1-76c9-81c2-3020ab660001");
  });

  it("searches by user ID once typing pauses, and reopens the first match", async () => {
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    fetchSamples.mockClear();
    fetchSamples.mockResolvedValue({ samples: [second], truncated: false });
    const search = screen.getByLabelText("按用户 ID 搜索请求");
    fireEvent.change(search, { target: { value: "u" } });
    fireEvent.change(search, { target: { value: "uid_oth" } });
    await waitFor(() => expect(fetchSamples).toHaveBeenCalled());
    // One request for the settled text, not one per keystroke.
    expect(fetchSamples).toHaveBeenCalledTimes(1);
    expect(fetchSamples.mock.calls[0][1]).toBe("uid_oth");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /503|http/ })).toHaveLength(1),
    );
    const summary = within(screen.getByRole("list", { name: "请求概览" }));
    expect(summary.getByText("服务端错误")).toBeTruthy();
  });

  it("explains an empty search and a range with nothing", async () => {
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    fetchSamples.mockResolvedValue({ samples: [], truncated: false });
    fireEvent.change(screen.getByLabelText("按用户 ID 搜索请求"), { target: { value: "nobody" } });
    expect(await screen.findByText("没有匹配的请求")).toBeTruthy();
    expect(screen.getByText(/选择左侧的一条请求/)).toBeTruthy();
  });

  it("says when the list holds only the newest requests", async () => {
    fetchSamples.mockResolvedValue({ samples: [first], truncated: true });
    mount();
    expect(await screen.findByText(/只显示最新的 1 条/)).toBeTruthy();
  });

  it("flags a request slower than the endpoint's P95", async () => {
    fetchSamples.mockResolvedValue({ samples: [sample({ durationMs: 1500 })], truncated: false });
    mount();
    expect(await screen.findByText("慢于该 endpoint 的 P95")).toBeTruthy();
  });

  it("splits what a request carries into request, response and attribute tabs", async () => {
    fetchSamples.mockResolvedValue({
      samples: [
        sample({
          requestHeaders: { "x-request-id": "r-1" },
          responseHeaders: { etag: '"abc"', "content-type": "application/json" },
          attributes: { plan: "pro" },
        }),
      ],
      truncated: false,
    });
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    const extra = within(screen.getByRole("heading", { name: "附加信息" }).closest("section")!);
    expect(extra.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "请求",
      "响应",
      "自定义属性",
    ]);

    // Opens on the first tab with something in it; headers are a name/value table.
    const request = within(extra.getByRole("table", { name: "请求头" }));
    expect(request.getByRole("rowheader", { name: "x-request-id" })).toBeTruthy();
    expect(request.getByText("r-1")).toBeTruthy();
    expect(extra.queryByRole("table", { name: "响应头" })).toBeNull();
    expect(extra.queryByRole("link", { name: "管理头信息采集" })).toBeNull();

    await userEvent.click(extra.getByRole("tab", { name: "响应" }));
    const response = within(extra.getByRole("table", { name: "响应头" }));
    expect(response.getByRole("rowheader", { name: "etag" })).toBeTruthy();
    expect(response.getByText('"abc"')).toBeTruthy();

    await userEvent.click(extra.getByRole("tab", { name: "自定义属性" }));
    const attributes = within(extra.getByRole("table", { name: "自定义属性" }));
    expect(attributes.getByRole("rowheader", { name: "plan" })).toBeTruthy();
    expect(attributes.getByText("pro")).toBeTruthy();
  });

  it("keeps the picked tab while moving between requests", async () => {
    fetchSamples.mockResolvedValue({
      samples: [
        sample({ responseHeaders: { etag: '"one"' } }),
        sample({
          eventId: "018f4d9c-83a1-76c9-81c2-3020ab660009",
          timestamp: "2026-10-12T11:01:00.000Z",
          responseHeaders: { etag: '"two"' },
        }),
      ],
      truncated: false,
    });
    mount();
    const list = within(await screen.findByRole("list", { name: "请求列表" }));
    // Nothing on the request side, so it opens on the response.
    expect(screen.getByRole("table", { name: "响应头" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "请求" }));
    expect(screen.getByText(/请求头和请求体默认不采集/)).toBeTruthy();
    await userEvent.click(list.getAllByRole("button")[1]);
    expect(screen.getByText(/请求头和请求体默认不采集/)).toBeTruthy();
  });

  it("shows the bodies a project opted in to, indented, with what was done to them", async () => {
    fetchSamples.mockResolvedValue({
      samples: [
        sample({
          requestBody: '{"sku":"A-1","email":"[REDACTED]"}',
          responseBody: '{"orderId":"o-1"}',
        }),
      ],
      truncated: false,
    });
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    const extra = within(screen.getByRole("heading", { name: "附加信息" }).closest("section")!);
    expect(extra.getByText("请求体")).toBeTruthy();
    expect(extra.getByLabelText("请求体内容").textContent).toContain('"sku": "A-1"');
    expect(extra.getByText("敏感内容已被遮盖。")).toBeTruthy();
    expect(extra.getByRole("button", { name: "复制请求体" })).toBeTruthy();
    // Bodies sit under their own direction.
    expect(extra.queryByLabelText("响应体内容")).toBeNull();
    await userEvent.click(extra.getByRole("tab", { name: "响应" }));
    expect(extra.getByLabelText("响应体内容").textContent).toContain('"orderId": "o-1"');
  });

  it("explains that headers are off by default and links the endpoint's capture settings", async () => {
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    const extra = within(screen.getByRole("heading", { name: "附加信息" }).closest("section")!);
    expect(extra.getByText(/默认不采集/)).toBeTruthy();
    expect(extra.getByText(/3 天后自动删除/)).toBeTruthy();
    const link = extra.getByRole("link", { name: "管理头信息采集" }) as HTMLAnchorElement;
    const target = new URL(link.getAttribute("href")!, "https://console.example");
    expect(target.pathname).toBe(`/settings/project/${projectId}/api-capture`);
    expect(target.searchParams.get("method")).toBe("GET");
    expect(target.searchParams.get("url")).toBe("https://shop.example.com/api/payment-methods");
  });

  it("explains a body that was cut or omitted instead of showing a broken block", async () => {
    fetchSamples.mockResolvedValue({
      samples: [
        sample({
          requestBody: "[omitted: body larger than 64 KB]",
          responseBody: '{"a":"xxxx…[truncated]',
        }),
      ],
      truncated: false,
    });
    mount();
    await screen.findByRole("list", { name: "请求列表" });
    const extra = within(screen.getByRole("heading", { name: "附加信息" }).closest("section")!);
    expect(extra.getByText("内容超过 64 KB，没有采集。")).toBeTruthy();
    expect(extra.queryByLabelText("请求体内容")).toBeNull();
    await userEvent.click(extra.getByRole("tab", { name: "响应" }));
    expect(extra.getByText("内容已截断，只保留开头部分。")).toBeTruthy();
    expect(extra.getByLabelText("响应体内容")).toBeTruthy();
  });
});
