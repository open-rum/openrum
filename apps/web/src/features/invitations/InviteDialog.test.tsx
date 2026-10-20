// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInvitation,
  listInvitations,
  type CreatedInvitation,
  type Invitation,
} from "@/lib/api/invitations";
import { InviteDialog } from "./InviteDialog";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/lib/api/invitations", async (original) => ({
  ...(await original<typeof import("@/lib/api/invitations")>()),
  listInvitations: vi.fn(),
  createInvitation: vi.fn(),
}));
const session = vi.hoisted(() => ({ instanceRole: undefined as string | undefined }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  sessionQueryOptions: () => ({
    queryKey: ["auth", "session"],
    queryFn: async () => ({
      userId: "u1",
      email: "owner@example.test",
      displayName: "Owner",
      instanceRole: session.instanceRole,
    }),
  }),
}));

const link = "http://openrum.test/invite/ori_secret";
const organization = { id: "org-1", name: "Acme" };

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv-1",
    role: "member",
    email: null,
    createdByName: "Owner",
    createdAt: "2026-10-20T00:00:00Z",
    expiresAt: "2026-10-27T00:00:00Z",
    ...overrides,
  };
}

function created(overrides: Partial<CreatedInvitation> = {}): CreatedInvitation {
  return { invitation: invitation(), link, ...overrides };
}

const writeText = vi.fn(async (_text: string) => undefined);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});
/** user-event installs its own clipboard on setup, so ours goes in afterwards. */
function setupUser() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.instanceRole = undefined;
  vi.mocked(listInvitations).mockResolvedValue({ invitations: [], emailEnabled: true });
});
afterEach(cleanup);

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InviteDialog organization={organization} open onOpenChange={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("invite dialog", () => {
  it("says up front that an administrator still has to approve", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("邀请成员加入「Acme」")).toBeTruthy();
    expect(within(dialog).getByText(/管理员通过后才会加入组织/)).toBeTruthy();
  });

  it("makes a link for the chosen role, copies it and keeps it on screen", async () => {
    vi.mocked(createInvitation).mockResolvedValue(created());
    renderDialog();
    await setupUser().click(await screen.findByRole("button", { name: "生成并复制链接" }));

    expect(createInvitation).toHaveBeenCalledWith("org-1", { role: "member" });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(toast.success).toHaveBeenCalledWith("已复制");
    const field = (await screen.findByLabelText("邀请链接")) as HTMLInputElement;
    expect(field.value).toBe(link);
    expect(field.readOnly).toBe(true);
  });

  it("offers the link to copy by hand when the browser refuses the clipboard", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    vi.mocked(createInvitation).mockResolvedValue(created());
    renderDialog();
    await setupUser().click(await screen.findByRole("button", { name: "生成并复制链接" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("复制失败，请手动选择链接"));
    expect(((await screen.findByLabelText("邀请链接")) as HTMLInputElement).value).toBe(link);
  });

  it("forgets the link when another role is picked", async () => {
    const user = setupUser();
    vi.mocked(createInvitation).mockResolvedValue(created());
    renderDialog();
    await user.click(await screen.findByRole("button", { name: "生成并复制链接" }));
    await screen.findByLabelText("邀请链接");

    await user.click(screen.getByRole("combobox", { name: "加入后的角色" }));
    await user.click(await screen.findByRole("option", { name: "Viewer" }));

    expect(screen.queryByLabelText("邀请链接")).toBeNull();
    vi.mocked(createInvitation).mockResolvedValue(
      created({ invitation: invitation({ role: "viewer" }) }),
    );
    await user.click(screen.getByRole("button", { name: "生成并复制链接" }));
    expect(createInvitation).toHaveBeenLastCalledWith("org-1", { role: "viewer" });
  });

  it("mails the link to the address typed", async () => {
    const user = setupUser();
    vi.mocked(createInvitation).mockResolvedValue(
      created({
        invitation: invitation({ email: "new@example.test" }),
        delivery: { success: true, recipient: "new@example.test" },
      }),
    );
    renderDialog();
    await user.click(await screen.findByRole("tab", { name: "发送邮件" }));
    await user.type(screen.getByLabelText("收件邮箱"), "new@example.test");
    await user.click(screen.getByRole("button", { name: "发送邀请邮件" }));

    expect(createInvitation).toHaveBeenCalledWith("org-1", {
      role: "member",
      email: "new@example.test",
    });
    expect(await screen.findByText("已发送到 new@example.test")).toBeTruthy();
  });

  it("keeps the link when the mail could not be sent", async () => {
    const user = setupUser();
    vi.mocked(createInvitation).mockResolvedValue(
      created({
        invitation: invitation({ email: "new@example.test" }),
        delivery: {
          success: false,
          recipient: "new@example.test",
          stage: "connect",
          message: "connection refused",
        },
      }),
    );
    renderDialog();
    await user.click(await screen.findByRole("tab", { name: "发送邮件" }));
    await user.type(screen.getByLabelText("收件邮箱"), "new@example.test");
    await user.click(screen.getByRole("button", { name: "发送邀请邮件" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/邮件没有发出去：connection refused/)).toBeTruthy();
    expect((within(alert).getByLabelText("邀请链接") as HTMLInputElement).value).toBe(link);
    expect(screen.queryByText(/已发送到/)).toBeNull();
  });

  it("disables mail, and says why, when the instance has no mail server", async () => {
    vi.mocked(listInvitations).mockResolvedValue({ invitations: [], emailEnabled: false });
    renderDialog();
    const tab = await screen.findByRole("tab", { name: "发送邮件" });
    await waitFor(() => expect(tab.hasAttribute("disabled")).toBe(true));
    expect(screen.getByText(/实例还没有配置邮件服务/)).toBeTruthy();
    // An ordinary administrator cannot fix it, so they are told who can.
    expect(screen.getByText(/需要实例管理员先配置/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "去配置邮件服务" })).toBeNull();
  });

  it("points an instance administrator to the mail settings", async () => {
    session.instanceRole = "instance_owner";
    vi.mocked(listInvitations).mockResolvedValue({ invitations: [], emailEnabled: false });
    renderDialog();
    const settings = await screen.findByRole("link", { name: "去配置邮件服务" });
    expect(settings.getAttribute("href")).toBe("/settings/instance/email");
  });
});
