// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLog, getLogs, type LogEntry, type LogFilters, type LogPage } from "@/lib/api/logs";
import { LogsPage } from "./LogsPage";

const state = vi.hoisted(() => ({
  from: new Date("2026-11-11T00:00:00Z"),
  to: new Date("2026-11-12T00:00:00Z"),
}));
vi.mock("@tanstack/react-router", () => ({ useParams: () => ({ projectId: "project-1" }) }));
vi.mock("@/features/filters/AnalysisContextBar", () => ({ useAnalysisContext: () => state }));
vi.mock("@/lib/api/logs", async (original) => ({
  ...(await original<typeof import("@/lib/api/logs")>()),
  getLogs: vi.fn(),
  getLog: vi.fn(),
}));
vi.mock("./LogFilterComposer", () => ({
  LogFilterComposer: ({
    filters,
    onChange,
  }: {
    filters: LogFilters;
    onChange: (patch: Partial<LogFilters>) => void;
  }) => (
    <input
      aria-label="搜索日志"
      value={filters.q ?? ""}
      onChange={(event) => onChange({ q: event.target.value })}
    />
  ),
}));
vi.mock("./LogTrend", () => ({ LogTrend: () => <div>日志趋势</div> }));
const sessionId = "a25753a5-0714-4555-9c99-cd8c20a90722";
const entry: LogEntry = {
  eventId: "13af3016-0096-4e8f-a51b-5a0a6facd321",
  timestamp: "2026-11-11T13:21:31.184Z",
  level: "error",
  message: "payment failed",
  logger: "payment",
  environment: "production",
  release: "v1",
  route: "/checkout",
  pageUrl: "https://example.com/checkout",
  browser: "Chrome",
  deviceType: "mobile",
  country: "CN",
  sessionId,
  userId: "customer-1",
  anonymousUserId: "visitor-1",
  traceId: "trace-1",
  spanId: "span-1",
  attributes: { "error.code": "TIMEOUT" },
  sampleRate: 1,
};
const nextEntry = {
  ...entry,
  eventId: "23af3016-0096-4e8f-a51b-5a0a6facd321",
  timestamp: "2026-11-11T13:21:27.000Z",
  level: "info" as const,
  message: "checkout started",
};
const page = (items = [entry, nextEntry], nextCursor = ""): LogPage => ({
  items,
  total: items.length,
  trend: [],
  intervalSeconds: 3600,
  nextCursor,
});
let client: QueryClient;
function mount(search = "") {
  window.history.replaceState(
    {},
    "",
    `/projects/project-1/logs?from=${state.from.toISOString()}&to=${state.to.toISOString()}${search}`,
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const app = (
    <QueryClientProvider client={client}>
      <LogsPage />
    </QueryClientProvider>
  );
  const result = render(app);
  return {
    ...result,
    refresh: () =>
      result.rerender(
        <QueryClientProvider client={client}>
          <LogsPage />
        </QueryClientProvider>,
      ),
  };
}
beforeEach(() => {
  localStorage.clear();
  state.from = new Date("2026-11-11T00:00:00Z");
  state.to = new Date("2026-11-12T00:00:00Z");
  vi.mocked(getLogs).mockResolvedValue(page());
  vi.mocked(getLog).mockResolvedValue(entry);
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});

describe("Logs investigation", () => {
  it("keeps an open log and its scroll position when the relative time advances", async () => {
    const view = mount("&timePreset=24h");
    fireEvent.click(await screen.findByRole("button", { name: "payment failed" }));
    const dialog = screen.getByRole("dialog", { name: "日志详情" });
    const body = dialog.querySelector(".overflow-y-auto")!;
    body.scrollTop = 150;
    state.from = new Date("2026-11-11T00:01:00Z");
    state.to = new Date("2026-11-12T00:01:00Z");
    view.refresh();
    await waitFor(() =>
      expect(vi.mocked(getLogs).mock.calls.at(-1)?.[0].to).toBe(state.to.toISOString()),
    );
    expect(screen.getByRole("dialog", { name: "日志详情" })).toBe(dialog);
    expect(body.scrollTop).toBe(150);
    expect(within(dialog).getByText("payment failed")).toBeTruthy();
    expect(getLog).not.toHaveBeenCalled();
  });
  it("opens all related logs and restores the original error search and selected log", async () => {
    const view = mount("&q=level:error");
    fireEvent.click(await screen.findByRole("button", { name: "payment failed" }));
    fireEvent.click(screen.getByRole("button", { name: "同会话全部日志" }));
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("q")).toBe(
        `session_id:"${sessionId}"`,
      ),
    );
    expect(new URLSearchParams(window.location.search).has("timePreset")).toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "日志详情" })).toBeNull());
    const sharedSearch = window.location.search.slice(1);
    view.unmount();
    client.clear();
    mount(`&${sharedSearch}`);
    await screen.findByRole("button", { name: "返回原搜索" });
    fireEvent.click(screen.getByRole("button", { name: "返回原搜索" }));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("level:error");
    expect(screen.getByRole("dialog", { name: "日志详情" })).toBeTruthy();
  });
  it("keeps attribute filtering additive and allows the next log to be read", async () => {
    mount("&q=level:error");
    fireEvent.click(await screen.findByRole("button", { name: "payment failed" }));
    fireEvent.click(screen.getByRole("button", { name: "下一条日志" }));
    expect(new URLSearchParams(window.location.search).get("log")).toBe(nextEntry.eventId);
    expect(within(screen.getByRole("dialog")).getByText("checkout started")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "error.code 操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "按此值筛选" }));
    expect(new URLSearchParams(window.location.search).get("q")).toBe(
      'level:error AND attributes.error.code:"TIMEOUT"',
    );
  });
  it("loads a shared log independently of the current page and handles a missing log", async () => {
    vi.mocked(getLogs).mockResolvedValue(page([nextEntry]));
    mount(`&log=${entry.eventId}&logAt=${entry.timestamp}`);
    const dialog = await screen.findByRole("dialog", { name: "日志详情" });
    await within(dialog).findByText("payment failed");
    expect(getLog).toHaveBeenCalledWith(
      "project-1",
      entry.eventId,
      entry.timestamp,
      expect.any(AbortSignal),
    );
    vi.mocked(getLog).mockResolvedValueOnce(null);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["log-detail"] });
    });
    expect(await within(dialog).findByText("未找到这条日志")).toBeTruthy();
  });
  it("returns to the previous batch and resets the cursor when the search changes", async () => {
    vi.mocked(getLogs).mockImplementation(async (filters) =>
      filters.cursor ? page([nextEntry]) : page([entry], "cursor-2"),
    );
    mount("&timePreset=24h");
    fireEvent.click(await screen.findByRole("button", { name: "更早日志" }));
    await screen.findByRole("button", { name: "checkout started" });
    expect(new URLSearchParams(window.location.search).has("timePreset")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "上一批" }));
    await screen.findByRole("button", { name: "payment failed" });
    expect(new URLSearchParams(window.location.search).has("cursor")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "更早日志" }));
    await screen.findByRole("button", { name: "checkout started" });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索日志" }), {
      target: { value: "no-match" },
    });
    expect(new URLSearchParams(window.location.search).has("cursor")).toBe(false);
  });
  it("shows search recovery without SDK setup or empty pagination", async () => {
    vi.mocked(getLogs).mockResolvedValue(page([]));
    mount("&q=no-match");
    await screen.findByText("没有匹配当前条件的日志");
    expect(screen.queryByText("日志接入说明")).toBeNull();
    expect(screen.queryByRole("button", { name: "更早日志" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索条件" }));
    await screen.findByText("当前时间范围没有日志");
    expect(screen.getByText("日志接入说明").closest("details")?.open).toBe(false);
  });
  it("expands one row without opening the drawer and highlights the active message search", async () => {
    mount("&q=failed");
    const message = await screen.findByRole("button", { name: "payment failed" });
    expect(message.querySelector("mark")?.textContent).toBe("failed");
    fireEvent.click(within(message.closest("tr")!).getByRole("button", { name: /^展开日志/ }));
    expect(screen.queryByRole("dialog", { name: "日志详情" })).toBeNull();
    expect(screen.getAllByLabelText("日志行详情")).toHaveLength(1);
    expect(screen.getByText("TIMEOUT")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看完整详情" }));
    expect(
      within(screen.getByRole("dialog", { name: "日志详情" })).getByText("failed").tagName,
    ).toBe("MARK");
  });
  it("adds an attribute column from detail, persists it and supports exclusion", async () => {
    const view = mount("&q=level:error");
    await userEvent.click(await screen.findByRole("button", { name: "payment failed" }));
    await userEvent.click(screen.getByRole("button", { name: "error.code 操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "添加为列" }));
    await userEvent.click(screen.getByRole("button", { name: "关闭日志详情" }));
    await screen.findByRole("columnheader", { name: /^error\.code/ });
    view.unmount();
    client.clear();
    mount("&q=level:error");
    await screen.findByRole("columnheader", { name: /^error\.code/ });
    await userEvent.click(screen.getAllByRole("button", { name: "attributes.error.code 操作" })[0]);
    await userEvent.click(screen.getByRole("menuitem", { name: "排除此值" }));
    expect(new URLSearchParams(window.location.search).get("q")).toBe(
      'level:error AND !attributes.error.code:"TIMEOUT"',
    );
    fireEvent.click(screen.getByRole("button", { name: "移除 error.code 列" }));
    expect(screen.queryByRole("columnheader", { name: /^error\.code/ })).toBeNull();
  });
  it("keeps context anchored through both paging directions and return to the original search", async () => {
    vi.mocked(getLogs).mockImplementation(async (filters) =>
      filters.anchor
        ? {
            ...page(filters.cursor ? [nextEntry] : [nextEntry, entry], "after-cursor"),
            previousCursor: "before-cursor",
          }
        : page(),
    );
    mount("&q=level:error");
    fireEvent.click(await screen.findByRole("button", { name: "payment failed" }));
    fireEvent.click(screen.getByRole("button", { name: "同会话全部日志" }));
    await screen.findByText("原日志");
    const params = () => new URLSearchParams(window.location.search);
    expect(params().get("anchor")).toBe(entry.eventId);
    expect(params().get("anchorAt")).toBe(entry.timestamp);
    const table = screen.getByRole("table", { name: "日志列表" });
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector(".logs-message-button")?.textContent),
    ).toEqual(["checkout started", "payment failed"]);
    fireEvent.click(screen.getByRole("button", { name: "更早日志" }));
    await waitFor(() => expect(params().get("direction")).toBe("before"));
    expect(params().get("cursor")).toBe("before-cursor");
    await waitFor(() => expect(screen.queryByText("原日志")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "更晚日志" }));
    await waitFor(() => expect(params().get("direction")).toBe("after"));
    expect(params().get("anchor")).toBe(entry.eventId);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "定位原日志" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "定位原日志" }));
    await screen.findByText("原日志");
    expect(params().has("cursor")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "返回原搜索" }));
    expect(params().has("anchor")).toBe(false);
    expect(params().get("q")).toBe("level:error");
  });
  it("ignores an orphaned page direction after the global time picker clears the cursor", async () => {
    mount(`&anchor=${entry.eventId}&anchorAt=${entry.timestamp}&direction=before`);
    await screen.findByRole("button", { name: "payment failed" });
    expect(vi.mocked(getLogs).mock.calls.at(-1)?.[0].direction).toBeUndefined();
  });
});
