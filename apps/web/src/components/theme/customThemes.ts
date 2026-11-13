import { TAILWIND_PALETTE, type TailwindShade } from "./tailwindPalette";

// Custom themes: random daisyUI themes a person adds from the theme menu. They follow the
// rules of daisyUI's own theme generator (daisyui.com/theme-generator, "Random"): Tailwind
// palette colours, a neutral or coloured base, content colours from the opposite end of
// the same hue. Like the generator, there is no contrast check beyond those rules (user
// decision, 2026-11-09). Themes live in this browser only, next to `openrum-theme`.

export const CUSTOM_THEMES_STORAGE_KEY = "openrum-custom-themes";
export const CUSTOM_THEME_STYLE_ID = "openrum-custom-themes";
const ID_PREFIX = "custom-";
const NAME_PREFIX = "自定义";
/** A menu with this many is long enough; adding beyond it is refused. */
export const MAX_CUSTOM_THEMES = 20;

export type CustomThemeId = `custom-${string}`;
export type CustomTheme = {
  id: CustomThemeId;
  name: string;
  colorScheme: "light" | "dark";
  /** daisyUI theme variables: `--color-*`, `--radius-*`, `--size-*`, `--border`, `--depth`, `--noise`. */
  vars: Record<string, string>;
};

type Random = () => number;

const NEUTRALS = ["slate", "gray", "zinc", "neutral", "stone"];
const HUES = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];
// daisyUI's weights for primary, secondary and accent; black is the most likely.
const BRAND_WEIGHTS: Record<string, number> = {
  amber: 3,
  black: 5,
  blue: 4,
  cyan: 2,
  emerald: 3,
  fuchsia: 1,
  gray: 1,
  green: 3,
  indigo: 4,
  lime: 3,
  neutral: 1,
  orange: 3,
  pink: 3,
  purple: 3,
  red: 3,
  rose: 1,
  sky: 2,
  slate: 1,
  stone: 1,
  teal: 3,
  violet: 3,
  yellow: 3,
  zinc: 1,
};
const BLACK = "oklch(0% 0 0)";
const WHITE = "oklch(100% 0 0)";

export function isCustomThemeId(value: string | null | undefined): value is CustomThemeId {
  return (
    typeof value === "string" && value.startsWith(ID_PREFIX) && value.length > ID_PREFIX.length
  );
}

/** A random daisyUI theme, drawn the way daisyUI's generator draws one. */
export function randomThemeVars(random: Random = Math.random) {
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)];
  const color = (name: string, shade: string) =>
    name === "black"
      ? BLACK
      : name === "white"
        ? WHITE
        : TAILWIND_PALETTE[name][shade as TailwindShade];
  const anyOf = (names: string[], shades: string[]) => {
    const name = pick(names);
    return { name, value: color(name, pick(shades)) };
  };
  // The text on a colour: the lightest shade of its hue on a dark fill, the darkest on a light one.
  const content = (name: string, shade: string) =>
    name === "black"
      ? WHITE
      : name === "white"
        ? BLACK
        : color(name, Number(shade) > 400 ? "50" : "950");

  const vars: Record<string, string> = {
    "--radius-selector": pick(["0rem", "0.25rem", "0.5rem", "1rem", "2rem"]),
    "--radius-field": pick(["0rem", "0.25rem", "0.5rem", "1rem", "2rem"]),
    "--radius-box": pick(["0rem", "0.25rem", "0.5rem", "1rem", "2rem"]),
    "--size-selector": "0.25rem",
    "--size-field": "0.25rem",
    "--border": pick(["1px", "1px", "1px", "1px", "1px", "1px", "1px", "1px", "1.5px", "2px"]),
    "--depth": pick(["0", "1"]),
    "--noise": pick(["0", "1"]),
  };
  const dark = random() > 0.5;
  const base = pick(random() < 0.3 ? HUES : NEUTRALS);
  const [b100, b200, b300, text] = dark
    ? ["950", "900", "800", "100"]
    : ["50", "100", "200", "900"];
  vars["--color-base-100"] = color(base, b100);
  vars["--color-base-200"] = color(base, b200);
  vars["--color-base-300"] = color(base, b300);
  vars["--color-base-content"] = color(base, text);
  vars["--color-neutral"] = color(base, pick(["600", "700", "800", "900", "950"]));
  vars["--color-neutral-content"] = content(base, "700");

  const stateShade = pick(["400", "500", "600"]);
  const states: Array<[string, string[]]> = [
    ["info", ["cyan", "sky", "blue"]],
    ["success", ["lime", "green", "emerald", "teal"]],
    ["warning", ["yellow", "amber", "orange"]],
    ["error", ["red", "pink", "rose"]],
  ];
  for (const [state, names] of states) {
    const { name, value } = anyOf(names, [stateShade]);
    vars[`--color-${state}`] = value;
    vars[`--color-${state}-content`] = content(name, stateShade);
  }

  const brandShade = pick(["300", "400", "500", "600"]);
  const pool = Object.entries(BRAND_WEIGHTS).flatMap(([name, weight]) =>
    Array.from({ length: weight }, () => name),
  );
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  (["primary", "secondary", "accent"] as const).forEach((role, index) => {
    vars[`--color-${role}`] = color(pool[index], brandShade);
    vars[`--color-${role}-content`] = content(pool[index], brandShade);
  });
  return { colorScheme: dark ? ("dark" as const) : ("light" as const), vars };
}

/** "自定义 N", one past the highest number in use. */
export function nextCustomThemeName(themes: CustomTheme[]) {
  const used = themes.map((theme) => {
    const match = new RegExp(`^${NAME_PREFIX} (\\d+)$`).exec(theme.name);
    return match ? Number(match[1]) : 0;
  });
  return `${NAME_PREFIX} ${Math.max(0, ...used) + 1}`;
}

export function createCustomTheme(
  themes: CustomTheme[],
  random: Random = Math.random,
): CustomTheme {
  const id = `${ID_PREFIX}${crypto.randomUUID().slice(0, 8)}` as CustomThemeId;
  return { id, name: nextCustomThemeName(themes), ...randomThemeVars(random) };
}

const VAR_NAME = /^--(color-[a-z0-9-]+|radius-[a-z]+|size-[a-z]+|border|depth|noise)$/;
// Only values the generator writes, so a hand-edited entry cannot inject CSS.
const VAR_VALUE = /^(oklch\([0-9.% ]+(none)?\)|[0-9.]+(rem|px)?)$/;

function isCustomTheme(value: unknown): value is CustomTheme {
  if (!value || typeof value !== "object") return false;
  const theme = value as Partial<CustomTheme>;
  return (
    isCustomThemeId(theme.id) &&
    /^[a-z0-9-]+$/.test(theme.id) &&
    typeof theme.name === "string" &&
    (theme.colorScheme === "light" || theme.colorScheme === "dark") &&
    !!theme.vars &&
    typeof theme.vars === "object" &&
    Object.entries(theme.vars).every(
      ([key, item]) => VAR_NAME.test(key) && typeof item === "string" && VAR_VALUE.test(item),
    )
  );
}

export function parseCustomThemes(raw: string | null): CustomTheme[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCustomTheme).slice(0, MAX_CUSTOM_THEMES) : [];
  } catch {
    return [];
  }
}

/** One rule per theme; daisyUI components and the Console's tokens read these variables. */
export function customThemesCss(themes: CustomTheme[]) {
  return themes
    .map((theme) => {
      const declarations = Object.entries(theme.vars)
        .map(([key, value]) => `${key}:${value}`)
        .join(";");
      return `[data-theme="${theme.id}"]{color-scheme:${theme.colorScheme};${declarations}}`;
    })
    .join("\n");
}
