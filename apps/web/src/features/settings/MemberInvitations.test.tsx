// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveJoinRequest,
  createInvitation,
  rejectJoinRequest,
  revokeInvitation,
  type Invitation,
  type JoinRequest,
} from "@/lib/api/invitations";
import { InvitationsPanel, JoinRequestsPanel } from "./MemberInvitations";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/api/invitations", async (original) => ({
  ...(await original<typeof import("@/lib/api/invitations")>()),
  approveJoinRequest: vi.fn(),
  rejectJoinRequest: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

function request(overrides: Partial<JoinRequest> = {}): JoinRequest {
  return {
    id: "req-1",
    userId: "u1",
    email: "nina@example.test",
    displayName: "Nina",
    role: "member",
    createdAt: "2026-10-20T07:33:00Z",
    ...overrides,
  };
}

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv-1",
    role: "viewer",
    email: null,
    createdByName: "Olivia",
    createdAt: "2026-10-20T00:00:00Z",
    expiresAt: "2026-10-27T00:00:00Z",
    ...overrides,
  };
}

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
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(cleanup);

function wrap(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

describe("join requests", () => {
  it("explains where requests come from when there are none", () => {
    wrap(<JoinRequestsPanel organizationId="org-1" requests={[]} roles={["member"]} />);
    expect(screen.getByText(/没有待处理的加入申请/)).toBeTruthy();
  });

  it("approves with the role the link offered", async () => {
    vi.mocked(approveJoinRequest).mockResolvedValue(undefined);
    wrap(
      <JoinRequestsPanel
        organizationId="org-1"
        requests={[request({ role: "viewer" })]}
        roles={["admin", "member", "viewer"]}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "通过 Nina" }));

    expect(approveJoinRequest).toHaveBeenCalledWith("org-1", "req-1", "viewer");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("已通过 Nina 的申请"));
  });

  it("approves with another role when the administrator picks one", async () => {
    vi.mocked(approveJoinRequest).mockResolvedValue(undefined);
    const user = userEvent.setup();
    wrap(
      <JoinRequestsPanel
        organizationId="org-1"
        requests={[request()]}
        roles={["admin", "member", "viewer"]}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Nina 通过后的角色" }));
    await user.click(await screen.findByRole("option", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "通过 Nina" }));

    expect(approveJoinRequest).toHaveBeenCalledWith("org-1", "req-1", "admin");
  });

  it("rejects a request", async () => {
    vi.mocked(rejectJoinRequest).mockResolvedValue(undefined);
    wrap(<JoinRequestsPanel organizationId="org-1" requests={[request()]} roles={["member"]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "拒绝 Nina" }));

    expect(rejectJoinRequest).toHaveBeenCalledWith("org-1", "req-1");
    expect(approveJoinRequest).not.toHaveBeenCalled();
  });

  it("shows why a decision failed", async () => {
    vi.mocked(approveJoinRequest).mockRejectedValue(new Error("没有权限"));
    wrap(<JoinRequestsPanel organizationId="org-1" requests={[request()]} roles={["member"]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "通过 Nina" }));
    expect((await screen.findByRole("alert")).textContent).toBe("没有权限");
  });
});

describe("open invitations", () => {
  it("points to the invite button when there are none", () => {
    wrap(<InvitationsPanel organizationId="org-1" invitations={[]} />);
    expect(screen.getByText(/没有有效的邀请链接/)).toBeTruthy();
  });

  it("lists who each link was sent to, and calls an unaddressed one a plain link", () => {
    wrap(
      <InvitationsPanel
        organizationId="org-1"
        invitations={[invitation(), invitation({ id: "inv-2", email: "a@example.test" })]}
      />,
    );
    expect(screen.getByText("仅链接")).toBeTruthy();
    expect(screen.getByText("a@example.test")).toBeTruthy();
    // A link's secret is not kept, so only an addressed one can be sent again.
    expect(screen.getAllByRole("button", { name: /^重新发送给/ })).toHaveLength(1);
  });

  it("revokes only after confirmation", async () => {
    vi.mocked(revokeInvitation).mockResolvedValue(undefined);
    const user = userEvent.setup();
    wrap(<InvitationsPanel organizationId="org-1" invitations={[invitation()]} />);

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: /^撤销/ }));
    expect(revokeInvitation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^撤销/ }));
    expect(revokeInvitation).toHaveBeenCalledWith("org-1", "inv-1");
  });

  it("sends a new link before revoking the old one, so a failed send keeps the old", async () => {
    const calls: string[] = [];
    vi.mocked(createInvitation).mockImplementation(async () => {
      calls.push("create");
      return {
        invitation: invitation({ id: "inv-9" }),
        link: "http://openrum.test/invite/ori_new",
        delivery: { success: true, recipient: "a@example.test" },
      };
    });
    vi.mocked(revokeInvitation).mockImplementation(async () => {
      calls.push("revoke");
    });
    wrap(
      <InvitationsPanel
        organizationId="org-1"
        invitations={[invitation({ email: "a@example.test" })]}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "重新发送给 a@example.test" }));

    await waitFor(() => expect(calls).toEqual(["create", "revoke"]));
    expect(createInvitation).toHaveBeenCalledWith("org-1", {
      role: "viewer",
      email: "a@example.test",
    });
    expect(revokeInvitation).toHaveBeenCalledWith("org-1", "inv-1");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("已重新发送到 a@example.test"));
  });

  it("withdraws the new link and keeps the old one when the mail does not go out", async () => {
    vi.mocked(createInvitation).mockResolvedValue({
      invitation: invitation({ id: "inv-9" }),
      link: "http://openrum.test/invite/ori_new",
      delivery: {
        success: false,
        recipient: "a@example.test",
        stage: "connect",
        message: "connection refused",
      },
    });
    vi.mocked(revokeInvitation).mockResolvedValue(undefined);
    wrap(
      <InvitationsPanel
        organizationId="org-1"
        invitations={[invitation({ email: "a@example.test" })]}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "重新发送给 a@example.test" }));

    expect((await screen.findByRole("alert")).textContent).toContain("connection refused");
    expect(revokeInvitation).toHaveBeenCalledTimes(1);
    expect(revokeInvitation).toHaveBeenCalledWith("org-1", "inv-9");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
