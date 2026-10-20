// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthMethods, startOAuthLogin, type AuthMethods } from "@/lib/auth/providers";
import {
  getRegistrationStatus,
  registerWithEmail,
  resendVerification,
  type RegistrationStatus,
} from "@/lib/auth/registration";
import { HTTPError } from "@/lib/auth/session";
import { RegisterPage } from "./RegisterPage";

vi.mock("@/lib/auth/registration", async (original) => ({
  ...(await original<typeof import("@/lib/auth/registration")>()),
  getRegistrationStatus: vi.fn(),
  registerWithEmail: vi.fn(),
  resendVerification: vi.fn(),
}));
vi.mock("@/lib/auth/providers", async (original) => ({
  ...(await original<typeof import("@/lib/auth/providers")>()),
  getAuthMethods: vi.fn(),
  startOAuthLogin: vi.fn(),
}));
vi.mock("@/components/theme/ThemeToggle", () => ({ ThemeToggle: () => null }));

function status(overrides: Partial<RegistrationStatus> = {}): RegistrationStatus {
  return { open: true, email: true, ...overrides };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RegisterPage />
    </QueryClientProvider>,
  );
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  password: string,
  confirm = password,
) {
  await user.type(screen.getByLabelText("用户名"), "Nina New");
  await user.type(screen.getByLabelText("邮箱"), "Nina@Example.com");
  await user.type(screen.getByLabelText("密码"), password);
  await user.type(screen.getByLabelText("确认密码"), confirm);
  await user.click(screen.getByRole("button", { name: "注册" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRegistrationStatus).mockResolvedValue(status());
  vi.mocked(getAuthMethods).mockResolvedValue({ local: true, providers: [] } as AuthMethods);
});
afterEach(cleanup);

describe("registration page", () => {
  it("says so when registration is closed and offers no form", async () => {
    vi.mocked(getRegistrationStatus).mockResolvedValue(status({ open: false, email: false }));
    renderPage();
    expect(await screen.findByText("暂未开放注册")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("shows the password rule and refuses a weak or mismatched password before sending", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("form", { name: "使用邮箱注册" });
    expect(screen.getByText("至少 8 个字符，须同时包含大写字母、小写字母和符号。")).toBeTruthy();

    await fillForm(user, "Str0ng-pass", "Str0ng-pasz");
    expect((await screen.findByRole("alert")).textContent).toContain("两次输入的密码不一致");
    expect(registerWithEmail).not.toHaveBeenCalled();
  });

  it("sends the address, then asks the person to check their mail and can resend", async () => {
    const user = userEvent.setup();
    vi.mocked(registerWithEmail).mockResolvedValue({ status: "verification_sent" });
    vi.mocked(resendVerification).mockResolvedValue({ status: "verification_sent" });
    renderPage();
    await screen.findByRole("form", { name: "使用邮箱注册" });
    await fillForm(user, "Str0ng-pass");

    await screen.findByText("请查收验证邮件");
    expect(vi.mocked(registerWithEmail).mock.calls[0]?.[0]).toEqual({
      displayName: "Nina New",
      email: "Nina@Example.com",
      password: "Str0ng-pass",
    });
    // It never claims whether the address was new.
    expect(screen.getByText(/如果 nina@example.com 可以注册/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "重新发送验证邮件" }));
    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith("nina@example.com"));
    expect(await screen.findByText("已重新发送，请稍等片刻。")).toBeTruthy();
  });

  it("explains failures in words", async () => {
    const user = userEvent.setup();
    vi.mocked(registerWithEmail).mockRejectedValue(
      new HTTPError(502, "EMAIL_DELIVERY_FAILED", "", "The verification email could not be sent."),
    );
    renderPage();
    await screen.findByRole("form", { name: "使用邮箱注册" });
    await fillForm(user, "Str0ng-pass");
    expect((await screen.findByRole("alert")).textContent).toContain("验证邮件没能发出");
  });

  it("turns the email form off without a mail server but keeps external sign-up", async () => {
    const user = userEvent.setup();
    vi.mocked(getRegistrationStatus).mockResolvedValue(status({ email: false }));
    vi.mocked(getAuthMethods).mockResolvedValue({
      local: true,
      providers: [
        { id: "github", kind: "github", label: "GitHub" },
        { id: "company", kind: "ldap", label: "公司目录" },
      ],
    });
    vi.mocked(startOAuthLogin).mockResolvedValue({ authorizationUrl: "about:blank#provider" });
    renderPage();
    expect(await screen.findByText(/邮箱注册需要管理员先配置邮件服务/)).toBeTruthy();
    expect(screen.queryByRole("form", { name: "使用邮箱注册" })).toBeNull();
    // A directory signs people in; it has nothing to register.
    expect(screen.queryByRole("button", { name: /公司目录/ })).toBeNull();
    expect(screen.getByText(/使用公司目录账号的人，直接登录即可/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "使用 GitHub 注册" }));
    await waitFor(() => expect(startOAuthLogin).toHaveBeenCalledWith("github", "/"));
  });
});
