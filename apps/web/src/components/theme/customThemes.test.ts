import { describe, expect, it } from "vitest";
import {
  createCustomTheme,
  customThemesCss,
  nextCustomThemeName,
  parseCustomThemes,
  randomThemeVars,
  type CustomTheme,
} from "./customThemes";

// A seeded generator, so a draw is repeatable.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

const COLOR_VARS = [
  "base-100",
  "base-200",
  "base-300",
  "base-content",
  "neutral",
  "neutral-content",
  "primary",
  "primary-content",
  "secondary",
  "secondary-content",
  "accent",
  "accent-content",
  "info",
  "info-content",
  "success",
  "success-content",
  "warning",
  "warning-content",
  "error",
  "error-content",
];

describe("randomThemeVars", () => {
  it("draws every daisyUI variable from the Tailwind palette", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { colorScheme, vars } = randomThemeVars(seeded(seed));
      expect(["light", "dark"]).toContain(colorScheme);
      for (const name of COLOR_VARS) expect(vars[`--color-${name}`]).toMatch(/^oklch\(/);
      expect(["0rem", "0.25rem", "0.5rem", "1rem", "2rem"]).toContain(vars["--radius-box"]);
      expect(["1px", "1.5px", "2px"]).toContain(vars["--border"]);
    }
  });

  it("puts dark themes on the darkest shades and light themes on the lightest", () => {
    const lightness = (value: string) => Number(/oklch\(([0-9.]+)%/.exec(value)![1]);
    for (let seed = 1; seed <= 100; seed++) {
      const { colorScheme, vars } = randomThemeVars(seeded(seed));
      const base = lightness(vars["--color-base-100"]);
      const text = lightness(vars["--color-base-content"]);
      if (colorScheme === "dark") expect(base).toBeLessThan(text);
      else expect(base).toBeGreaterThan(text);
    }
  });
});

describe("custom theme list", () => {
  it("names themes one past the highest number in use", () => {
    const named = (name: string) => ({ name }) as CustomTheme;
    expect(nextCustomThemeName([])).toBe("自定义 1");
    expect(nextCustomThemeName([named("自定义 1"), named("自定义 4")])).toBe("自定义 5");
  });

  it("round-trips through storage, including the `none` hue of grey shades", () => {
    const themes = Array.from({ length: 30 }, (_, index) =>
      createCustomTheme([], seeded(index + 1)),
    );
    const restored = parseCustomThemes(JSON.stringify(themes.slice(0, 5)));
    expect(restored).toEqual(themes.slice(0, 5));
    expect(
      themes.some((theme) => Object.values(theme.vars).some((value) => value.includes("none"))),
    ).toBe(true);
    // The list is capped where the menu stops being useful.
    expect(parseCustomThemes(JSON.stringify(themes))).toHaveLength(20);
  });

  it("drops entries that could inject CSS", () => {
    const theme = createCustomTheme([], seeded(3));
    const tampered = {
      ...theme,
      vars: { ...theme.vars, "--color-primary": "red} body{display:none" },
    };
    expect(parseCustomThemes(JSON.stringify([tampered]))).toEqual([]);
    expect(parseCustomThemes("not json")).toEqual([]);
  });

  it("writes one rule per theme keyed by its id", () => {
    const theme = createCustomTheme([], seeded(5));
    const css = customThemesCss([theme]);
    expect(css.startsWith(`[data-theme="${theme.id}"]{color-scheme:${theme.colorScheme};`)).toBe(
      true,
    );
    expect(css).toContain(`--color-primary:${theme.vars["--color-primary"]}`);
  });
});
