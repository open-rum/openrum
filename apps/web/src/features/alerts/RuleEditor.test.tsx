// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAlert, createChannel, testChannel } from "@/lib/api/alerts";
import type { Project } from "@/lib/api/projects";
import { RuleEditor } from "./RuleEditor";

vi.mock("@/lib/api/alerts", async (original) => ({
  ...(await original<typeof import("@/lib/api/alerts")>()),
  createAlert: vi.fn(),
  createChannel: vi.fn(),
  testChannel: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeAll(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterAll(() => vi.unstubAllGlobals());
const project: Project = {
  id: "p1",
  organizationId: "org1",
  name: "Store",
  slug: "store",
  sdkPlatform: "react",
  allowedOrigins: [],
  environment: "production",
  environments: ["production"],
  retentionDays: 30,
  eventSampleRate: 1,
  apiSampleRate: 1,
  errorSampleRate: 1,
  ingestRateLimit: null,
  overLimitBehavior: "reject",
  defaultIngestRateLimit: 5000,
  status: "active",
  role: "owner",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};
function renderEditor() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RuleEditor
        project={project}
        state={{ mode: "create" }}
        rules={[]}
        channels={[]}
        canManageChannels
        defaultEnvironment="production"
        onClose={onClose}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { client, onClose };
}
describe("alert draft while configuring channels", () => {
  it("keeps the rule draft and returns focus when channel setup is cancelled", async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor();
    await user.type(screen.getByLabelText("规则名称"), "Checkout LCP");
    const threshold = screen.getByLabelText("触发条件");
    await user.clear(threshold);
    await user.type(threshold, "3000");
    await user.click(screen.getByRole("button", { name: "添加飞书渠道" }));
    const dialog = screen.getByRole("dialog", { name: "添加飞书渠道" });
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加飞书渠道" })).toBeNull());
    expect((screen.getByLabelText("规则名称") as HTMLInputElement).value).toBe("Checkout LCP");
    expect((screen.getByLabelText("触发条件") as HTMLInputElement).value).toBe("3000");
    expect(onClose).not.toHaveBeenCalled();
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("refreshes selectable channels after saving without submitting or clearing the rule", async () => {
    const user = userEvent.setup();
    vi.mocked(createChannel).mockResolvedValue({
      id: "ch1",
      organizationId: "org1",
      name: "飞书通知",
      kind: "feishu",
      enabled: true,
      ruleCount: 0,
      createdAt: project.createdAt,
    });
    vi.mocked(testChannel).mockResolvedValue({ delivered: true });
    const { client, onClose } = renderEditor();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await user.type(screen.getByLabelText("规则名称"), "Keep this draft");
    await user.click(screen.getByRole("button", { name: "添加飞书渠道" }));
    const dialog = screen.getByRole("dialog", { name: "添加飞书渠道" });
    await user.type(
      within(dialog).getByLabelText("Webhook 地址"),
      "https://open.feishu.cn/open-apis/bot/v2/hook/test",
    );
    await user.click(within(dialog).getByRole("button", { name: /保存/ }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["channels", "org1"] }),
    );
    expect((screen.getByLabelText("规则名称") as HTMLInputElement).value).toBe("Keep this draft");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("rule editing workflow", () => {
  it("protects unsaved edits when the editor is dismissed", async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor();
    await user.type(screen.getByLabelText("规则名称"), "Draft rule");
    await user.click(screen.getByRole("button", { name: "取消" }));
    const warning = screen.getByRole("alertdialog", { name: "放弃未保存的修改？" });
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(warning).getByRole("button", { name: "继续编辑" }));
    expect((screen.getByLabelText("规则名称") as HTMLInputElement).value).toBe("Draft rule");
    await user.click(screen.getByRole("button", { name: "关闭规则编辑器" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("validates the new metric's unit and never submits an invalid threshold", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText("规则名称"), "API availability");
    await user.selectOptions(screen.getByLabelText("指标"), "api_failure_rate");
    expect((screen.getByLabelText("触发条件") as HTMLInputElement).value).toBe("5");
    await user.clear(screen.getByLabelText("触发条件"));
    await user.type(screen.getByLabelText("触发条件"), "150");
    await user.click(screen.getByRole("button", { name: "创建规则" }));
    expect(screen.getByText("API 失败率不会超过 100%。")).toBeTruthy();
    expect(createAlert).not.toHaveBeenCalled();
  });
  it("saves an intentionally paused console-only rule", async () => {
    const user = userEvent.setup();
    renderEditor();
    vi.mocked(createAlert).mockResolvedValue({
      id: "r1",
      projectId: "p1",
      name: "Draft",
      metric: "error_rate",
      comparator: "gte",
      threshold: 2,
      windowMinutes: 5,
      cooldownMinutes: 30,
      environment: "production",
      enabled: false,
      channelIds: [],
      lastStatus: "",
      recentStatuses: [],
    });
    await user.type(screen.getByLabelText("规则名称"), " Draft ");
    await user.click(screen.getByRole("switch", { name: "保存后立即启用" }));
    await user.click(screen.getByRole("button", { name: "创建规则" }));
    await waitFor(() =>
      expect(createAlert).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ name: "Draft", enabled: false, channelIds: [] }),
      ),
    );
  });
});
