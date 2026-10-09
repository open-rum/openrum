// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUploadToken,
  listUploadTokens,
  revokeUploadToken,
  type UploadToken,
} from "@/lib/api/uploadTokens";
import { UploadTokensSection } from "./UploadTokensSection";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/api/uploadTokens", () => ({
  listUploadTokens: vi.fn(),
  createUploadToken: vi.fn(),
  revokeUploadToken: vi.fn(),
}));
vi.mock("@/components/ui/hold-button", () => ({
  HoldButton: ({
    children,
    onHold,
    "aria-label": label,
  }: {
    children: React.ReactNode;
    onHold?: () => void;
    "aria-label"?: string;
  }) => (
    <button type="button" aria-label={label} onClick={onHold}>
      {children}
    </button>
  ),
}));

const now = "2026-09-30T00:00:00Z";
function token(overrides: Partial<UploadToken> = {}): UploadToken {
  return {
    id: "token-1",
    name: "GitHub Actions",
    tokenPrefix: "orut_AbCdEfG",
    createdByName: "李杰",
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

const writeText = vi.fn(async () => undefined);
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UploadTokensSection projectId="project-1" />
    </QueryClientProvider>,
  );
}

describe("upload tokens", () => {
  it("lists tokens with prefix, creator, usage and revoked state", async () => {
    vi.mocked(listUploadTokens).mockResolvedValue({
      canManage: true,
      tokens: [
        token(),
        token({ id: "token-2", name: "旧流水线", revokedAt: now, lastUsedAt: now }),
      ],
    });
    const view = renderSection();
    const table = await view.findByRole("table", { name: "上传令牌" });
    expect(within(table).getAllByText("orut_AbCdEfG…")).toHaveLength(2);
    expect(within(table).getAllByText("李杰")).toHaveLength(2);
    expect(within(table).getByText("尚未使用")).toBeTruthy();
    expect(within(table).getByText("已吊销")).toBeTruthy();
    expect(view.queryByRole("button", { name: "长按吊销上传令牌 旧流水线" })).toBeNull();
  });

  it("creates a token and reveals the secret once with a copy action", async () => {
    vi.mocked(listUploadTokens).mockResolvedValue({ canManage: true, tokens: [] });
    vi.mocked(createUploadToken).mockResolvedValue({
      token: token({ name: "CI" }),
      secret: "orut_secret-value",
    });
    const view = renderSection();
    fireEvent.click(await view.findByRole("button", { name: "新建令牌" }));
    const dialog = await view.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("例如：GitHub Actions · web"), {
      target: { value: "  CI  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => expect(createUploadToken).toHaveBeenCalledWith("project-1", "CI"));
    expect(await within(dialog).findByText("orut_secret-value")).toBeTruthy();
    expect(within(dialog).getByText("明文只显示这一次")).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith("已创建上传令牌「CI」");

    fireEvent.click(within(dialog).getByRole("button", { name: "复制令牌" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("orut_secret-value"));
    expect(await within(dialog).findByRole("button", { name: "已复制" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "我已保存" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    fireEvent.click(view.getByRole("button", { name: "新建令牌" }));
    const reopened = await view.findByRole("dialog");
    expect(within(reopened).queryByText("orut_secret-value")).toBeNull();
  });

  it("revokes a token after the hold and confirms with a toast", async () => {
    vi.mocked(listUploadTokens).mockResolvedValue({ canManage: true, tokens: [token()] });
    vi.mocked(revokeUploadToken).mockResolvedValue(undefined);
    const view = renderSection();
    fireEvent.click(await view.findByRole("button", { name: "长按吊销上传令牌 GitHub Actions" }));
    await waitFor(() => expect(revokeUploadToken).toHaveBeenCalledWith("project-1", "token-1"));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("已吊销上传令牌「GitHub Actions」"),
    );
  });

  it("hides management actions from members", async () => {
    vi.mocked(listUploadTokens).mockResolvedValue({ canManage: false, tokens: [token()] });
    const view = renderSection();
    await view.findByRole("table", { name: "上传令牌" });
    expect(view.queryByRole("button", { name: "新建令牌" })).toBeNull();
    expect(view.queryByRole("button", { name: /长按吊销/ })).toBeNull();
    expect(view.getByText("只有项目 Owner 或 Admin 可以新建和吊销上传令牌。")).toBeTruthy();
  });
});
