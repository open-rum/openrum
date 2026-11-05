import { CheckIcon, ChevronDownIcon, Monitor } from "lucide-react";
import { DaisyDropdown } from "@/components/daisy/DaisyDropdown";
import { DAISY_THEMES } from "@/components/daisy/daisyTheme";
import { ThemeSwatch } from "@/components/daisy/ThemeSwatch";
import { useTheme, type Theme } from "./ThemeProvider";

/**
 * The theme switch at the top-right, as on daisyUI's site: the icon previews the theme in
 * effect, and the menu lists every daisyUI theme plus "跟随系统".
 */
export function ThemeController() {
  const { theme, daisyTheme, setTheme } = useTheme();
  const label = theme === "system" ? "跟随系统" : theme;
  const item = (value: Theme, close: () => void, content: React.ReactNode) => (
    <li key={value}>
      <button
        type="button"
        className={theme === value ? "menu-active" : undefined}
        aria-pressed={theme === value}
        onClick={() => {
          setTheme(value);
          close();
        }}
      >
        {content}
        {theme === value ? <CheckIcon className="ml-auto size-4" aria-hidden="true" /> : null}
      </button>
    </li>
  );
  return (
    <DaisyDropdown
      label={`切换主题，当前为 ${label}`}
      title={`主题：${label}`}
      triggerClassName="btn btn-ghost btn-sm gap-1.5 px-1.5"
      menuClassName="max-h-[min(70vh,32rem)] w-56 flex-nowrap overflow-y-auto"
      trigger={
        <>
          <ThemeSwatch theme={daisyTheme} size="lg" />
          <ChevronDownIcon className="size-4 opacity-60" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <>
          {item(
            "system",
            close,
            <>
              <Monitor className="size-4" aria-hidden="true" />
              跟随系统
            </>,
          )}
          <li className="menu-title">主题</li>
          {DAISY_THEMES.map((value) =>
            item(
              value,
              close,
              <>
                <ThemeSwatch theme={value} />
                {value}
              </>,
            ),
          )}
        </>
      )}
    </DaisyDropdown>
  );
}
