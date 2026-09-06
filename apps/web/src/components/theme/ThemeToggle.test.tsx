// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
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

  it("switches from light to dark with one click", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle showLabel />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "切换至暗色模式" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("openrum-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "切换至亮色模式" })).toBeTruthy();
  });
});
