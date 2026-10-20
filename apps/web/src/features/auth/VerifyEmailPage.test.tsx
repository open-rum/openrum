// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resendVerification, verifyEmail } from "@/lib/auth/registration";
import { HTTPError } from "@/lib/auth/session";
import { VerifyEmailPage } from "./VerifyEmailPage";

vi.mock("@tanstack/react-router", () => ({ useParams: () => ({ token: "orev_secret" }) }));
vi.mock("@/lib/auth/registration", async (original) => ({
  ...(await original<typeof import("@/lib/auth/registration")>()),
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
}));
vi.mock("@/components/theme/ThemeToggle", () => ({ ThemeToggle: () => null }));

const replace = vi.fn();

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <VerifyEmailPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    value: { ...window.location, replace },
    writable: true,
  });
});
afterEach(cleanup);

describe("email verification page", () => {
  it("verifies once on arrival and enters the console", async () => {
    vi.mocked(verifyEmail).mockResolvedValue({ userId: "u1", accessStatus: "approved" });
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(verifyEmail).toHaveBeenCalledWith("orev_secret");
  });

  it("offers a new link when this one is used up or expired", async () => {
    const user = userEvent.setup();
    vi.mocked(verifyEmail).mockRejectedValue(
      new HTTPError(410, "VERIFICATION_INVALID", "", "This verification link is no longer valid."),
    );
    vi.mocked(resendVerification).mockResolvedValue({ status: "verification_sent" });
    renderPage();
    expect(await screen.findByText("这个验证链接已失效")).toBeTruthy();
    await user.type(screen.getByLabelText("邮箱"), "nina@example.com");
    await user.click(screen.getByRole("button", { name: "重新发送验证邮件" }));
    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith("nina@example.com"));
    expect(await screen.findByText(/新的链接已经发出/)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not suggest a resend for a failure that is not the link's fault", async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new HTTPError(500, "INTERNAL_ERROR", "", "boom"));
    renderPage();
    expect(await screen.findByText("无法完成验证")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "重新发送验证邮件" })).toBeNull();
  });
});
