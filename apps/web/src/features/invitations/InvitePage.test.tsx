// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInvitationPreview,
  joinWithInvitation,
  registerWithInvitation,
  type InvitationPreview,
} from "@/lib/api/invitations";
import { HTTPError, type SessionUser } from "@/lib/auth/session";
import { InvitePage } from "./InvitePage";

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ token: "ori_secret" }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/lib/api/invitations", async (original) => ({
  ...(await original<typeof import("@/lib/api/invitations")>()),
  getInvitationPreview: vi.fn(),
  registerWithInvitation: vi.fn(),
  joinWithInvitation: vi.fn(),
}));
const signedIn = vi.hoisted(() => ({ user: undefined as unknown }));
vi.mock("@/lib/auth/session", async (original) => {
  const real = await original<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    logout: vi.fn(),
    sessionQueryOptions: () => ({
      queryKey: ["auth", "session"],
      queryFn: async () => {
        if (!signedIn.user) throw new real.HTTPError(401, "UNAUTHENTICATED", "", "signed out");
        return signedIn.user as SessionUser;
      },
      retry: false,
    }),
  };
});
vi.mock("@/components/theme/ThemeToggle", () => ({ ThemeToggle: () => null }));

function preview(overrides: Partial<InvitationPreview> = {}): InvitationPreview {
  return {
    organizationName: "Acme",
    inviterName: "Olivia",
    role: "member",
    state: "valid",
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InvitePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn.user = undefined;
  vi.mocked(getInvitationPreview).mockResolvedValue(preview());
});
afterEach(cleanup);

describe("invitation page", () => {
  it("says a link that does not exist is invalid", async () => {
    vi.mocked(getInvitationPreview).mockRejectedValue(
      new HTTPError(404, "NOT_FOUND", "", "Resource not found."),
    );
    renderPage();
    expect(await screen.findByText("这个邀请链接无效")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it.each([
    ["expired", "这个邀请已过期"],
    ["revoked", "这个邀请已被撤销"],
  ] as const)("refuses a %s link and names who to ask", async (state, title) => {
    vi.mocked(getInvitationPreview).mockResolvedValue(preview({ state }));
    renderPage();
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText(/联系「Acme」的管理员/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /申请加入/ })).toBeNull();
  });

  it("lets a visitor register, and makes clear that approval is still needed", async () => {
    vi.mocked(registerWithInvitation).mockResolvedValue({ userId: "u1", organizationName: "Acme" });
    renderPage();
    await screen.findByRole("form", { name: "注册并申请加入" });
    expect(screen.getByText(/Olivia 邀请你以 Member 身份加入/)).toBeTruthy();
    expect(screen.getByText(/需要管理员通过才会生效/)).toBeTruthy();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("姓名"), "Nina");
    await user.type(screen.getByLabelText("邮箱"), "nina@example.test");
    await user.type(screen.getByLabelText("密码"), "A-production-password");
    await user.click(screen.getByRole("button", { name: "注册并申请加入" }));

    expect(registerWithInvitation).toHaveBeenCalledWith("ori_secret", {
      displayName: "Nina",
      email: "nina@example.test",
      password: "A-production-password",
    });
  });

  it("sends someone who already has an account to sign in and come back", async () => {
    renderPage();
    const login = await screen.findByRole("link", { name: "登录后申请" });
    expect(login.getAttribute("href")).toBe("/login?returnTo=%2Finvite%2Fori_secret");
  });

  it("tells a taken email to sign in instead", async () => {
    vi.mocked(registerWithInvitation).mockRejectedValue(
      new HTTPError(409, "EMAIL_TAKEN", "", "taken"),
    );
    renderPage();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("姓名"), "Nina");
    await user.type(screen.getByLabelText("邮箱"), "nina@example.test");
    await user.type(screen.getByLabelText("密码"), "A-production-password");
    await user.click(screen.getByRole("button", { name: "注册并申请加入" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("这个邮箱已经注册过了");
    expect(screen.getAllByRole("link", { name: /登录/ }).length).toBeGreaterThan(0);
  });

  it("lets a signed-in user ask to join with the account they are using", async () => {
    signedIn.user = {
      userId: "u2",
      email: "ada@example.test",
      displayName: "Ada",
      accessStatus: "approved",
    };
    vi.mocked(joinWithInvitation).mockResolvedValue({
      outcome: "requested",
      organizationName: "Acme",
    });
    renderPage();
    expect(await screen.findByText(/Ada（ada@example.test）/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "申请加入" }));

    expect(joinWithInvitation).toHaveBeenCalledWith("ori_secret");
    expect(await screen.findByText("申请已提交，等待管理员通过")).toBeTruthy();
    expect(screen.getByText(/通过时不会另行通知/)).toBeTruthy();
  });

  it("does not promise a notification to someone who is already a member", async () => {
    signedIn.user = {
      userId: "u3",
      email: "owner@example.test",
      displayName: "Owner",
      accessStatus: "approved",
    };
    vi.mocked(joinWithInvitation).mockResolvedValue({
      outcome: "already_member",
      organizationName: "Acme",
    });
    renderPage();
    await userEvent.setup().click(await screen.findByRole("button", { name: "申请加入" }));

    expect(await screen.findByText("你已经是这个组织的成员")).toBeTruthy();
    expect(screen.queryByText(/通过时不会另行通知/)).toBeNull();
  });

  it("explains a request that is refused because the link has lapsed", async () => {
    signedIn.user = {
      userId: "u4",
      email: "ada@example.test",
      displayName: "Ada",
      accessStatus: "approved",
    };
    vi.mocked(joinWithInvitation).mockRejectedValue(
      new HTTPError(410, "INVITATION_INVALID", "", "gone"),
    );
    renderPage();
    await userEvent.setup().click(await screen.findByRole("button", { name: "申请加入" }));
    expect((await screen.findByRole("alert")).textContent).toContain("这个邀请已经失效");
  });

  it("sends a waiting account back to its own request instead of a second one", async () => {
    signedIn.user = {
      userId: "u5",
      email: "wait@example.test",
      displayName: "Wait",
      accessStatus: "pending",
    };
    renderPage();
    expect(await screen.findByText("你的账号正在等待管理员通过")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "申请加入" })).toBeNull();
    expect(screen.getByRole("link", { name: "查看申请状态" }).getAttribute("href")).toBe(
      "/awaiting-access",
    );
  });
});
