// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeExternalRegistration, getExternalProfile } from "@/lib/auth/registration";
import { HTTPError } from "@/lib/auth/session";
import { CompleteRegistrationPage } from "./CompleteRegistrationPage";

vi.mock("@/lib/auth/registration", async (original) => ({
  ...(await original<typeof import("@/lib/auth/registration")>()),
  getExternalProfile: vi.fn(),
  completeExternalRegistration: vi.fn(),
}));
vi.mock("@/components/theme/ThemeToggle", () => ({ ThemeToggle: () => null }));

const replace = vi.fn();

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CompleteRegistrationPage />
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

describe("finishing an external sign-up", () => {
  it("asks for an address, keeps the page when it is taken, and enters once it is free", async () => {
    const user = userEvent.setup();
    vi.mocked(getExternalProfile).mockResolvedValue({
      providerLabel: "GitHub",
      displayName: "octocat",
    });
    vi.mocked(completeExternalRegistration)
      .mockRejectedValueOnce(new HTTPError(409, "EMAIL_TAKEN", "", "taken"))
      .mockResolvedValueOnce({ returnTo: "/", accessStatus: "approved" });
    renderPage();
    expect(await screen.findByText(/GitHub 没有提供邮箱/)).toBeTruthy();
    // The provider's name is only a suggestion.
    expect((screen.getByLabelText("用户名") as HTMLInputElement).value).toBe("octocat");

    await user.type(screen.getByLabelText("邮箱"), "Taken@Example.com");
    await user.click(screen.getByRole("button", { name: "完成注册" }));
    expect((await screen.findByRole("alert")).textContent).toContain("这个邮箱已经有人在用了");
    expect(replace).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("邮箱"));
    await user.type(screen.getByLabelText("邮箱"), "free@example.com");
    await user.click(screen.getByRole("button", { name: "完成注册" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(vi.mocked(completeExternalRegistration).mock.calls[1]?.[0]).toEqual({
      displayName: "octocat",
      email: "free@example.com",
    });
  });

  it("says the sign-up expired when there is nothing to finish", async () => {
    vi.mocked(getExternalProfile).mockRejectedValue(
      new HTTPError(410, "REGISTRATION_EXPIRED", "", "gone"),
    );
    renderPage();
    expect(await screen.findByText("注册已过期")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });
});
