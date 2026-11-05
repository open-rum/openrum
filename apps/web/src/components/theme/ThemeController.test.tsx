// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeController } from "./ThemeController";
import { ThemeProvider } from "./ThemeProvider";

describe("ThemeController", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it("applies and remembers a daisyUI theme, and follows the system again", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeController />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "切换主题，当前为 跟随系统" })).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("light");

    await user.click(screen.getByRole("button", { name: "dracula", hidden: true }));
    expect(document.documentElement.dataset.theme).toBe("dracula");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("openrum-theme")).toBe("dracula");

    await user.click(screen.getByRole("button", { name: "cupcake", hidden: true }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.click(screen.getByRole("button", { name: "跟随系统", hidden: true }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("openrum-theme")).toBe("system");
  });
});
