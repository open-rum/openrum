import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DARK_DAISY_THEMES, isDaisyTheme, type DaisyTheme } from "@/components/daisy/daisyTheme";
import {
  CUSTOM_THEME_STYLE_ID,
  CUSTOM_THEMES_STORAGE_KEY,
  MAX_CUSTOM_THEMES,
  createCustomTheme,
  customThemesCss,
  isCustomThemeId,
  parseCustomThemes,
  randomThemeVars,
  type CustomTheme,
  type CustomThemeId,
} from "./customThemes";

/**
 * Any daisyUI theme, or a custom theme added in this browser. The Console no longer follows
 * the operating system's appearance.
 */
export type Theme = DaisyTheme | CustomThemeId;
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  /** Whether the theme in effect is light or dark. */
  resolvedTheme: ResolvedTheme;
  /** The theme in effect, written to `<html data-theme>`. */
  daisyTheme: Theme;
  setTheme: (theme: Theme) => void;
  customThemes: CustomTheme[];
  /** Whether a random theme is being tried out (shown, not saved). */
  previewing: boolean;
  /** Shows a new random theme without saving it; any theme choice ends the preview. */
  previewRandomTheme: () => void;
  /**
   * Saves the theme being tried out, or a new random one, and switches to it; false when
   * the list is full.
   */
  addCustomTheme: () => boolean;
  removeCustomTheme: (id: CustomThemeId) => void;
};

const STORAGE_KEY = "openrum-theme";
/** The `data-theme` of a random theme being tried out; it is never stored. */
const PREVIEW_ID = "custom-preview";
const DEFAULT_THEME: Theme = "light";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}

function getStoredCustomThemes() {
  return parseCustomThemes(readStorage(CUSTOM_THEMES_STORAGE_KEY));
}

// A value that is not a daisyUI theme or a stored custom theme, including the retired
// "system", reads as the default.
function getStoredTheme(customThemes: CustomTheme[]): Theme {
  const stored = readStorage(STORAGE_KEY);
  if (isDaisyTheme(stored)) return stored;
  if (isCustomThemeId(stored) && customThemes.some((item) => item.id === stored)) return stored;
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(getStoredCustomThemes);
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme(customThemes));
  const [preview, setPreview] = useState<ReturnType<typeof randomThemeVars> | null>(null);
  const daisyTheme: Theme = preview ? PREVIEW_ID : theme;
  const custom = customThemes.find((item) => item.id === theme);
  const resolvedTheme: ResolvedTheme = preview
    ? preview.colorScheme
    : custom
      ? custom.colorScheme
      : DARK_DAISY_THEMES.has(theme as DaisyTheme)
        ? "dark"
        : "light";

  // Every custom theme gets its rule, so the menu's swatches can preview them all.
  // index.html writes the selected one into the same element before first paint.
  useLayoutEffect(() => {
    let style = document.getElementById(CUSTOM_THEME_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = CUSTOM_THEME_STYLE_ID;
      document.head.append(style);
    }
    style.textContent = customThemesCss(
      preview ? [...customThemes, { id: PREVIEW_ID, name: "", ...preview }] : customThemes,
    );
  }, [customThemes, preview]);

  const selectTheme = useCallback((nextTheme: Theme) => {
    writeStorage(STORAGE_KEY, nextTheme);
    setThemeState(nextTheme);
    setPreview(null);
  }, []);

  const saveCustomThemes = useCallback((next: CustomTheme[]) => {
    writeStorage(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(next));
    setCustomThemes(next);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.dataset.theme = daisyTheme;
    root.style.colorScheme = resolvedTheme;
    const canvas = getComputedStyle(root).getPropertyValue("--ds-canvas").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", canvas);
  }, [daisyTheme, resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      daisyTheme,
      setTheme: selectTheme,
      customThemes,
      previewing: preview !== null,
      previewRandomTheme() {
        setPreview(randomThemeVars());
      },
      addCustomTheme() {
        if (customThemes.length >= MAX_CUSTOM_THEMES) return false;
        const created = createCustomTheme(customThemes);
        const added = preview ? { ...created, ...preview } : created;
        saveCustomThemes([...customThemes, added]);
        selectTheme(added.id);
        return true;
      },
      removeCustomTheme(id) {
        saveCustomThemes(customThemes.filter((item) => item.id !== id));
        if (theme === id) selectTheme(DEFAULT_THEME);
      },
    }),
    [customThemes, daisyTheme, preview, resolvedTheme, saveCustomThemes, selectTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
