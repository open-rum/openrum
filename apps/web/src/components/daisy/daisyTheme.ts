/** Every theme daisyUI ships, in the order its documentation lists them. */
export const DAISY_THEMES = [
  "light",
  "dark",
  "cupcake",
  "bumblebee",
  "emerald",
  "corporate",
  "synthwave",
  "retro",
  "cyberpunk",
  "valentine",
  "halloween",
  "garden",
  "forest",
  "aqua",
  "lofi",
  "pastel",
  "fantasy",
  "wireframe",
  "black",
  "luxury",
  "dracula",
  "cmyk",
  "autumn",
  "business",
  "acid",
  "lemonade",
  "night",
  "coffee",
  "winter",
  "dim",
  "nord",
  "sunset",
  "caramellatte",
  "abyss",
  "silk",
] as const;

export type DaisyTheme = (typeof DAISY_THEMES)[number];

/** The themes daisyUI marks `color-scheme: dark`; they turn on the Console's dark variants. */
export const DARK_DAISY_THEMES: ReadonlySet<DaisyTheme> = new Set([
  "dark",
  "synthwave",
  "halloween",
  "forest",
  "aqua",
  "black",
  "luxury",
  "dracula",
  "business",
  "night",
  "coffee",
  "dim",
  "sunset",
  "abyss",
]);

export function isDaisyTheme(value: string | null): value is DaisyTheme {
  return DAISY_THEMES.includes(value as DaisyTheme);
}
