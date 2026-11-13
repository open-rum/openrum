// @vitest-environment jsdom

import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider";

let api: ReturnType<typeof useTheme> | null = null;
function State() {
  const context = useTheme();
  useEffect(() => {
    api = context;
  });
  const { theme, daisyTheme, resolvedTheme } = context;
  return <span data-testid="state">{`${theme}/${daisyTheme}/${resolvedTheme}`}</span>;
}

function renderWith(stored: string | null, systemDark = false) {
  if (stored) window.localStorage.setItem("openrum-theme", stored);
  // The operating system's appearance must not matter any more.
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

  it("starts on light and ignores a dark operating system", () => {
    expect(renderWith(null, true)).toBe("light/light/light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("reads the retired system setting as light", () => {
    expect(renderWith("system", true)).toBe("light/light/light");
  });

  it("restores a stored daisyUI theme and ignores unknown values", () => {
    expect(renderWith("nord")).toBe("nord/nord/light");
    cleanup();
    window.localStorage.clear();
    expect(renderWith("citrus")).toBe("light/light/light");
  });

  it("no longer writes the retired palette and density attributes", () => {
    renderWith("forest");
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(document.documentElement.dataset.density).toBeUndefined();
  });

  it("adds and removes custom themes and remembers the selected one", () => {
    renderWith(null);
    act(() => void api!.addCustomTheme());
    const added = api!.customThemes[0];
    expect(added.name).toBe("自定义 1");
    expect(document.documentElement.dataset.theme).toBe(added.id);
    expect(window.localStorage.getItem("openrum-theme")).toBe(added.id);
    expect(document.documentElement.classList.contains("dark")).toBe(added.colorScheme === "dark");
    expect(document.getElementById("openrum-custom-themes")?.textContent).toContain(added.id);

    // A fresh start restores it from storage.
    cleanup();
    expect(renderWith(null)).toBe(`${added.id}/${added.id}/${added.colorScheme}`);

    act(() => api!.removeCustomTheme(added.id));
    expect(api!.customThemes).toEqual([]);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("falls back to light when the stored custom theme is gone", () => {
    expect(renderWith("custom-deadbeef")).toBe("light/light/light");
  });

  it("tries out a random theme without saving it, then keeps it on add", () => {
    renderWith("nord");
    act(() => api!.previewRandomTheme());
    expect(api!.previewing).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("custom-preview");
    expect(window.localStorage.getItem("openrum-theme")).toBe("nord");
    expect(window.localStorage.getItem("openrum-custom-themes")).toBeNull();
    const shown = document.getElementById("openrum-custom-themes")?.textContent ?? "";

    act(() => void api!.addCustomTheme());
    const added = api!.customThemes[0];
    expect(api!.previewing).toBe(false);
    expect(document.documentElement.dataset.theme).toBe(added.id);
    // The saved theme is the one that was on screen, not a new draw.
    expect(shown).toContain(`--color-primary:${added.vars["--color-primary"]}`);
  });

  it("ends a preview when a theme is chosen", () => {
    renderWith("nord");
    act(() => api!.previewRandomTheme());
    act(() => api!.setTheme("nord"));
    expect(api!.previewing).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("nord");
  });

  it("previews from a custom theme too, and a hold saves that preview as a new theme", () => {
    renderWith(null);
    act(() => void api!.addCustomTheme());
    const first = api!.customThemes[0];
    act(() => api!.previewRandomTheme());
    expect(document.documentElement.dataset.theme).toBe("custom-preview");
    const shown = document.getElementById("openrum-custom-themes")?.textContent ?? "";
    act(() => void api!.addCustomTheme());
    const [kept, second] = api!.customThemes;
    // The saved theme never changes; the new one is what was on screen.
    expect(kept).toEqual(first);
    expect(second.name).toBe("自定义 2");
    expect(document.documentElement.dataset.theme).toBe(second.id);
    expect(shown).toContain(`[data-theme="custom-preview"]{color-scheme:${second.colorScheme};`);
    expect(shown).toContain(`--color-primary:${second.vars["--color-primary"]}`);
  });
});
