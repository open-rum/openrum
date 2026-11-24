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

  it("applies and remembers a daisyUI theme, and offers no system option", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeController />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "切换主题，当前为 light" })).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("light");

    await user.click(screen.getByRole("button", { name: "Amber Dark", hidden: true }));
    expect(document.documentElement.dataset.theme).toBe("amber-dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("openrum-theme")).toBe("amber-dark");
    expect(screen.getByRole("button", { name: "切换主题，当前为 Amber Dark" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "dracula", hidden: true }));
    expect(document.documentElement.dataset.theme).toBe("dracula");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("openrum-theme")).toBe("dracula");

    await user.click(screen.getByRole("button", { name: "cupcake", hidden: true }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    expect(screen.queryByRole("button", { name: "跟随系统", hidden: true })).toBeNull();

    await user.click(screen.getByRole("button", { name: "light", hidden: true }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("openrum-theme")).toBe("light");
  });
});
