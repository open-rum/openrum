// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Organization, Project } from "@/lib/api/projects";
import { ProjectSwitcher } from "./ProjectSwitcher";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/features/invitations/InviteDialog", () => ({
  InviteDialog: ({ open, organization }: { open: boolean; organization: { name: string } }) =>
    open ? <div role="dialog">邀请弹窗 {organization.name}</div> : null,
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

function organization(role: Organization["role"]): Organization {
  return {
    id: "org-1",
    name: "Acme",
    slug: "acme",
    role,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

async function openMenu(role: Organization["role"]) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectSwitcher organization={organization(role)} projects={[] as Project[]} loading={false}>
        <button type="button">切换项目</button>
      </ProjectSwitcher>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "切换项目" }));
  await screen.findByText("当前组织");
  return user;
}

describe("project switcher footer", () => {
  it("opens with the keyboard, closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProjectSwitcher organization={organization("owner")} projects={[]} loading={false}>
          <button>切换项目</button>
        </ProjectSwitcher>
      </QueryClientProvider>,
    );
    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByText("当前组织");
    await user.keyboard("{Escape}");
    expect(screen.queryByText("当前组织")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "切换项目" }));
  });
  it("lists every entry as its own button, with invitations for managers", async () => {
    await openMenu("owner");
    const footer = document.querySelector(".project-hover-card__footer") as HTMLElement;
    const entries = within(footer).getAllByRole("button");
    expect(entries.map((entry) => entry.textContent)).toEqual(["所有项目", "创建项目", "邀请成员"]);
    // One entry per row: the footer holds buttons directly, none shares a wrapper.
    expect(entries.every((entry) => entry.parentElement === footer)).toBe(true);
  });

  it.each(["member", "viewer"] as const)("hides invitations from a %s", async (role) => {
    await openMenu(role);
    expect(screen.queryByRole("button", { name: "邀请成员" })).toBeNull();
  });

  it("opens the invitation dialog for the current organization", async () => {
    const user = await openMenu("admin");
    await user.click(screen.getByRole("button", { name: "邀请成员" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("Acme");
  });
});

describe("project switcher environment", () => {
  it("stays open while the environment menu is open, so a pick lands on the menu", async () => {
    // Radix Select needs these pointer and scrolling APIs, which jsdom lacks.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => {};
    Element.prototype.scrollIntoView ??= () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ environments: [{ name: "production" }] })),
    );
    const onEnvironmentChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProjectSwitcher
          organization={organization("owner")}
          projects={[]}
          project={{ id: "p1", name: "Shop" } as Project}
          loading={false}
          onEnvironmentChange={onEnvironmentChange}
        >
          <button type="button">切换项目</button>
        </ProjectSwitcher>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "切换项目" }));
    await user.click(await screen.findByRole("combobox", { name: "切换数据环境" }));
    const option = await screen.findByRole("option", { name: /production/ });
    // Moving onto the portalled menu leaves the card; it must not close under the pointer.
    for (const element of [
      screen.getByRole("button", { name: "切换项目", hidden: true }),
      document.querySelector(".project-hover-card")!,
    ])
      fireEvent.pointerLeave(element, { pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByText("当前组织")).toBeTruthy();
    await user.click(option);
    expect(onEnvironmentChange).toHaveBeenCalledWith("production");
    vi.unstubAllGlobals();
  });
});
