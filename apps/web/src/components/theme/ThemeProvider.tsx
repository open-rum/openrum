import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DARK_DAISY_THEMES, isDaisyTheme, type DaisyTheme } from "@/components/daisy/daisyTheme";

/** "system" follows the OS with daisyUI's light and dark; anything else is a daisyUI theme. */
export type Theme = "system" | DaisyTheme;
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  /** Whether the theme in effect is light or dark. */
  resolvedTheme: ResolvedTheme;
  /** The daisyUI theme in effect, written to `<html data-theme>`. */
  daisyTheme: DaisyTheme;
  setTheme: (theme: Theme) => void;
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
  return isDaisyTheme(stored) ? stored : "system";
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const daisyTheme: DaisyTheme = theme === "system" ? systemTheme : theme;
  const resolvedTheme: ResolvedTheme = DARK_DAISY_THEMES.has(daisyTheme) ? "dark" : "light";

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
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
      setTheme(nextTheme) {
        writeStorage(STORAGE_KEY, nextTheme);
        setThemeState(nextTheme);
      },
    }),
    [daisyTheme, resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
