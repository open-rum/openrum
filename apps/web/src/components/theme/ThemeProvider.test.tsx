// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function State() {
  const { theme, daisyTheme, resolvedTheme } = useTheme();
  return <span data-testid="state">{`${theme}/${daisyTheme}/${resolvedTheme}`}</span>;
}

function renderWith(stored: string | null, systemDark = false) {
  if (stored) window.localStorage.setItem("openrum-theme", stored);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: systemDark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  render(
    <ThemeProvider>
      <State />
    </ThemeProvider>,
  );
  return screen.getByTestId("state").textContent;
}

describe("ThemeProvider", () => {
  afterEach(cleanup);
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    delete document.documentElement.dataset.theme;
  });

  it("follows the system with daisyUI's light and dark themes", () => {
    expect(renderWith(null, true)).toBe("system/dark/dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("restores a stored daisyUI theme and ignores unknown values", () => {
    expect(renderWith("nord")).toBe("nord/nord/light");
    cleanup();
    window.localStorage.clear();
    expect(renderWith("citrus")).toBe("system/light/light");
  });

  it("no longer writes the retired palette and density attributes", () => {
    renderWith("forest");
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(document.documentElement.dataset.density).toBeUndefined();
  });
});
