// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@openrum/design-tokens/catalog";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function Controls() {
  const { palette, setPalette, density, setDensity } = useTheme();
  return (
    <div>
      <span data-testid="state">{`${palette}/${density}`}</span>
      <button type="button" onClick={() => setPalette("magenta")}>
        magenta
      </button>
      <button type="button" onClick={() => setDensity("compact")}>
        compact
      </button>
    </div>
  );
}

describe("ThemeProvider palette and density", () => {
  afterEach(cleanup);
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.palette;
    delete document.documentElement.dataset.density;
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it("defaults to amber and comfortable, and ignores unknown stored values", () => {
    window.localStorage.setItem("openrum-palette", "citrus");
    window.localStorage.setItem("openrum-density", "tiny");
    render(
      <ThemeProvider>
        <Controls />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("amber/comfortable");
    expect(document.documentElement.dataset.palette).toBe("amber");
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("applies and remembers a palette and density", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Controls />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "magenta" }));
    await user.click(screen.getByRole("button", { name: "compact" }));
    expect(document.documentElement.dataset.palette).toBe("magenta");
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(window.localStorage.getItem("openrum-palette")).toBe("magenta");
    expect(window.localStorage.getItem("openrum-density")).toBe("compact");
  });

  it("offers palettes whose accents are the other card hues", () => {
    for (const palette of palettes) {
      expect(palette.dots[0]).toBe(palette.id);
      expect(new Set(palette.dots).size).toBe(4);
    }
    expect(palettes[0].id).toBe("amber");
  });
});
