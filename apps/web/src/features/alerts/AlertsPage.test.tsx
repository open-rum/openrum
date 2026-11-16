// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  getAlerts,
  getChannels,
  updateAlert,
  type AlertRule,
  type AlertNotification,
} from "@/lib/api/alerts";
import type { Project } from "@/lib/api/projects";
import { blankRule } from "./alertRules";
import { ProjectAlerts } from "./AlertsPage";
vi.mock("@/lib/api/alerts", async (original) => ({
  ...(await original<typeof import("@/lib/api/alerts")>()),
  getAlerts: vi.fn(),
  getChannels: vi.fn(),
  updateAlert: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.history.replaceState(null, "", "/projects/p1/alerts");
  vi.mocked(getChannels).mockResolvedValue({ channels: [], canManage: false });
});
const project = { id: "p1", name: "Store", organizationId: "o1" } as Project;
const rule: AlertRule = {
  ...blankRule("production"),
  id: "r1",
  projectId: "p1",
  name: "Checkout LCP",
  metric: "lcp_p75",
  threshold: 2500,
  lastStatus: "breached",
  lastEvaluatedAt: "2026-11-05T00:00:00Z",
  recentStatuses: ["ok", "breached"],
};
const notification: AlertNotification = {
  id: "n1",
  ruleId: "r1",
  title: "Checkout LCP",
  metric: "lcp_p75",
  comparator: "gte",
  value: 4500,
  threshold: 2500,
  environment: "production",
  occurredAt: "2026-11-05T00:00:00Z",
  deepLink: "/projects/p1/performance?route=checkout",
  status: "breached",
  delivery: "failed",
  deliveries: [
    {
      channelId: "c1",
      channelName: "值班群",
      channelKind: "feishu",
      status: "failed",
      attempts: 3,
      errorCode: "feishu_sign_invalid",
      at: "2026-11-05T00:00:00Z",
    },
  ],
};
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProjectAlerts project={project} />
    </QueryClientProvider>,
  );
  return client;
}
describe("alerts workflow", () => {
  it("lets a viewer inspect a rule and continue to its delivery failure and diagnosis", async () => {
    vi.mocked(getAlerts).mockResolvedValue({
      rules: [rule],
      notifications: [notification],
      canManage: false,
    });
    const client = show();
    fireEvent.click(await screen.findByRole("button", { name: "Checkout LCP" }));
    const detail = screen.getByRole("dialog", { name: "Checkout LCP" });
    expect(within(detail).queryByRole("button", { name: "编辑规则" })).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "查看该规则的记录" }));
    expect((screen.getByLabelText("记录所属规则") as HTMLSelectElement).value).toBe("r1");
    fireEvent.click(screen.getByText("查看 1 个渠道结果"));
    expect(screen.getByText(/签名校验失败/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "诊断" }).getAttribute("href")).toContain(
      "performance",
    );
    expect(screen.getByText(/最多加载 100 条/)).toBeTruthy();
    client.clear();
  });
  it("filters rules and clears an empty result without losing the rule list", async () => {
    vi.mocked(getAlerts).mockResolvedValue({ rules: [rule], notifications: [], canManage: false });
    const client = show();
    const search = await screen.findByRole("textbox", { name: "搜索规则" });
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("没有符合条件的规则")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("button", { name: "Checkout LCP" })).toBeTruthy();
    client.clear();
  });
  it("filters pending deliveries and clears combined filters after an empty result", async () => {
    vi.mocked(getAlerts).mockResolvedValue({
      rules: [rule],
      notifications: [
        notification,
        { ...notification, id: "n2", delivery: "pending", deliveries: [] },
      ],
      canManage: false,
    });
    const client = show();
    await screen.findByRole("button", { name: "Checkout LCP" });
    await userEvent.setup().click(screen.getByRole("tab", { name: /触发记录/ }));
    fireEvent.change(screen.getByLabelText("送达状态"), { target: { value: "pending" } });
    expect(screen.getAllByRole("link", { name: "诊断" })).toHaveLength(1);
    expect(screen.getByText(/等待投递结果/)).toBeTruthy();
    expect(screen.queryByText("查看 1 个渠道结果")).toBeNull();
    fireEvent.change(screen.getByLabelText("记录所属规则"), { target: { value: "r1" } });
    fireEvent.change(screen.getByLabelText("送达状态"), { target: { value: "cooldown" } });
    expect(screen.getByText("没有符合条件的触发记录")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect((screen.getByLabelText("记录所属规则") as HTMLSelectElement).value).toBe("all");
    expect((screen.getByLabelText("送达状态") as HTMLSelectElement).value).toBe("all");
    expect(screen.getAllByRole("link", { name: "诊断" })).toHaveLength(2);
    client.clear();
  });
  it("shows a failed read as unavailable instead of onboarding or a zero total", async () => {
    vi.mocked(getAlerts).mockRejectedValue(new Error("offline"));
    const client = show();
    expect(await screen.findByText("告警数据加载失败")).toBeTruthy();
    expect(screen.queryByText("先选一个你想监控的问题")).toBeNull();
    client.clear();
  });
  it("does not permit editing before notification destinations have loaded", async () => {
    vi.mocked(getAlerts).mockResolvedValue({
      rules: [{ ...rule, channelIds: ["c1"] }],
      notifications: [],
      canManage: true,
    });
    vi.mocked(getChannels).mockRejectedValue(new Error("offline"));
    const client = show();
    expect(await screen.findByText("通知渠道读取失败")).toBeTruthy();
    expect(screen.getByText("渠道信息暂不可用")).toBeTruthy();
    expect((screen.getByRole("button", { name: "新建规则" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "从模板添加" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    client.clear();
  });
  it("persists an inline pause and reloads the server result", async () => {
    vi.mocked(getAlerts).mockResolvedValue({ rules: [rule], notifications: [], canManage: true });
    vi.mocked(updateAlert).mockImplementation(async () => {
      const paused = { ...rule, enabled: false };
      vi.mocked(getAlerts).mockResolvedValue({
        rules: [paused],
        notifications: [],
        canManage: true,
      });
      return paused;
    });
    const client = show();
    fireEvent.click(await screen.findByRole("switch", { name: "停用规则 Checkout LCP" }));
    await waitFor(() => expect(updateAlert).toHaveBeenCalledWith("p1", "r1", { enabled: false }));
    expect(await screen.findByRole("switch", { name: "启用规则 Checkout LCP" })).toBeTruthy();
    client.clear();
  });
  it("opens a template from the add menu and a blank rule from the empty state", async () => {
    vi.mocked(getAlerts).mockResolvedValue({ rules: [rule], notifications: [], canManage: true });
    vi.mocked(getChannels).mockResolvedValue({ channels: [], canManage: true });
    const user = userEvent.setup();
    const client = show();
    await user.click(await screen.findByRole("button", { name: "从模板添加" }));
    await user.click(await screen.findByRole("menuitem", { name: /错误率超标/ }));
    expect(await screen.findByDisplayValue("错误率超标")).toBeTruthy();
    client.clear();
  });
  it("summarises what needs attention and opens the matching rules", async () => {
    const now = new Date().toISOString();
    const quiet: AlertRule = {
      ...rule,
      id: "r2",
      name: "Healthy API",
      lastStatus: "ok",
      recentStatuses: ["ok", "ok"],
    };
    const paused: AlertRule = { ...quiet, id: "r3", name: "Paused", enabled: false };
    const orphan: AlertRule = {
      ...quiet,
      id: "r4",
      name: "Orphan",
      channelIds: ["gone"],
    };
    vi.mocked(getAlerts).mockResolvedValue({
      rules: [paused, quiet, orphan, { ...rule, recentStatuses: ["ok", "breached", "failed"] }],
      notifications: [{ ...notification, occurredAt: now }],
      canManage: true,
    });
    vi.mocked(getChannels).mockResolvedValue({
      channels: [
        {
          id: "gone",
          organizationId: "o1",
          name: "旧渠道",
          kind: "feishu",
          enabled: false,
          ruleCount: 1,
          createdAt: now,
        },
      ],
      canManage: true,
    });
    const user = userEvent.setup();
    const client = show();
    const overview = await screen.findByRole("region", { name: "告警总览" });
    expect(within(overview).getByRole("button", { name: /正在超阈值1/ })).toBeTruthy();
    expect(within(overview).getByRole("button", { name: /近 24 小时触发1/ })).toBeTruthy();
    expect(within(overview).getByRole("button", { name: /送达失败1.*Checkout LCP/ })).toBeTruthy();
    expect(within(overview).getByText("1 条没有可用渠道")).toBeTruthy();
    // Problems first, healthy next, paused last.
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("button.link")?.textContent);
    expect(names).toEqual(["Checkout LCP", "Orphan", "Healthy API", "Paused"]);
    expect(
      screen.getByRole("img", { name: "最近 3 次评估：1 次超过阈值，1 次评估失败" }),
    ).toBeTruthy();
    expect(screen.getByText("值班群 发送失败")).toBeTruthy();
    await user.click(within(overview).getByRole("button", { name: /需要处理的规则/ }));
    expect(screen.getByRole("button", { name: "需处理1" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByRole("button", { name: "Healthy API" })).toBeNull();
    expect(screen.getByRole("button", { name: "Orphan" })).toBeTruthy();
    await user.click(within(overview).getByRole("button", { name: /送达失败/ }));
    expect((screen.getByLabelText("送达状态") as HTMLSelectElement).value).toBe("failed");
    client.clear();
  });
  it("shows the setup progress from the real channel state when there are no rules", async () => {
    vi.mocked(getAlerts).mockResolvedValue({ rules: [], notifications: [], canManage: true });
    vi.mocked(getChannels).mockResolvedValue({ channels: [], canManage: true });
    const client = show();
    expect(await screen.findByText("已完成 0 / 3")).toBeTruthy();
    // The header button and the first step both flag the missing channel.
    expect(screen.getAllByText("未配置")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "去配置渠道" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "告警总览" })).toBeNull();
    client.clear();
  });
  it("marks the channel step done once a channel is enabled", async () => {
    vi.mocked(getAlerts).mockResolvedValue({ rules: [], notifications: [], canManage: true });
    vi.mocked(getChannels).mockResolvedValue({
      channels: [
        {
          id: "c1",
          organizationId: "o1",
          name: "值班群",
          kind: "feishu",
          enabled: true,
          ruleCount: 0,
          createdAt: "2026-11-05T00:00:00Z",
        },
      ],
      canManage: true,
    });
    const client = show();
    expect(await screen.findByText("已完成 1 / 3")).toBeTruthy();
    expect(screen.getByText("已连接 1 个")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "去配置渠道" })).toBeNull();
    client.clear();
  });
});
