import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  defaultDensity,
  defaultPalette,
  densityStorageKey,
  isDensity,
  isPalette,
  paletteStorageKey,
  type Density,
  type Palette,
} from "@openrum/design-tokens/catalog";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = Exclude<Theme, "system">;

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  palette: Palette;
  setPalette: (palette: Palette) => void;
  density: Density;
  setDensity: (density: Density) => void;
};

const STORAGE_KEY = "openrum-theme";
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

function getStoredTheme(): Theme {
  const stored = readStorage(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function getStoredPalette(): Palette {
  const stored = readStorage(paletteStorageKey);
  return isPalette(stored) ? stored : defaultPalette;
}

function getStoredDensity(): Density {
  const stored = readStorage(densityStorageKey);
  return isDensity(stored) ? stored : defaultDensity;
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [palette, setPaletteState] = useState<Palette>(getStoredPalette);
  const [density, setDensityState] = useState<Density>(getStoredDensity);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.dataset.theme = resolvedTheme;
    root.dataset.palette = palette;
    root.dataset.density = density;
    root.style.colorScheme = resolvedTheme;
    const canvas = getComputedStyle(root).getPropertyValue("--ds-canvas").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", canvas);
  }, [density, palette, resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme(nextTheme) {
        writeStorage(STORAGE_KEY, nextTheme);
        setThemeState(nextTheme);
      },
      palette,
      setPalette(nextPalette) {
        writeStorage(paletteStorageKey, nextPalette);
        setPaletteState(nextPalette);
      },
      density,
      setDensity(nextDensity) {
        writeStorage(densityStorageKey, nextDensity);
        setDensityState(nextDensity);
      },
    }),
    [density, palette, resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
