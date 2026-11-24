import { CheckIcon, ChevronDownIcon, DicesIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { DaisyDropdown } from "@/components/daisy/DaisyDropdown";
import { DAISY_THEMES, themeLabel } from "@/components/daisy/daisyTheme";
import { ThemeSwatch } from "@/components/daisy/ThemeSwatch";
import { HoldButton } from "@/components/ui/hold-button";
import { MAX_CUSTOM_THEMES } from "./customThemes";
import { useTheme, type Theme } from "./ThemeProvider";

/**
 * The theme switch at the top-right, as on daisyUI's site: the icon previews the theme in
 * effect, and the menu lists every daisyUI theme. "随机配色" always tries out a random theme
 * without saving it, whatever is selected, and a hold saves the theme being tried out (or a
 * new random one). Saved themes never change. Custom themes are kept in this browser and
 * listed first.
 */
export function ThemeController() {
  const {
    theme,
    daisyTheme,
    setTheme,
    customThemes,
    previewing,
    previewRandomTheme,
    addCustomTheme,
    removeCustomTheme,
  } = useTheme();
  const label = previewing
    ? "随机配色（未保存）"
    : (customThemes.find((item) => item.id === theme)?.name ?? themeLabel(theme));
  const full = customThemes.length >= MAX_CUSTOM_THEMES;

  const choose = (value: Theme, name: string, close: () => void) => (
    <button
      type="button"
      className={!previewing && theme === value ? "menu-active min-w-0 flex-1" : "min-w-0 flex-1"}
      aria-pressed={!previewing && theme === value}
      onClick={() => {
        setTheme(value);
        close();
      }}
    >
      <ThemeSwatch theme={value} />
      <span className="truncate">{name}</span>
      {!previewing && theme === value ? (
        <CheckIcon className="ml-auto size-4" aria-hidden="true" />
      ) : null}
    </button>
  );

  return (
    <DaisyDropdown
      label={`切换主题，当前为 ${label}`}
      title={`主题：${label}`}
      triggerClassName="btn btn-ghost btn-sm gap-1.5 px-1.5"
      menuClassName="max-h-[min(70vh,34rem)] w-60 flex-nowrap overflow-y-auto"
      trigger={
        <>
          <ThemeSwatch theme={daisyTheme} size="lg" />
          <ChevronDownIcon className="size-4 opacity-60" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <>
          <li data-theme-actions="">
            {/* The flow reads left to right: try a random theme, then hold to keep it. The
                hold turns primary only once there is a preview to save. */}
            <div>
              {previewing ? (
                <p
                  className="flex items-center justify-start gap-2 self-stretch px-1 text-xs"
                  role="status"
                >
                  <ThemeSwatch theme={daisyTheme} />
                  <span className="font-medium">随机配色</span>
                  <span className="text-base-content/70">· 未保存</span>
                </p>
              ) : null}
              <div className="grid w-full grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn btn-sm w-full"
                  title="预览一套随机配色，不会保存"
                  onClick={previewRandomTheme}
                >
                  <DicesIcon className="size-4" aria-hidden="true" />
                  {previewing ? "换一个" : "随机配色"}
                </button>
                <HoldButton
                  tone="primary"
                  size="sm"
                  icon={previewing ? null : <PlusIcon className="size-4" aria-hidden="true" />}
                  doneLabel="已保存"
                  disabled={full}
                  onHold={() => addCustomTheme()}
                  className="w-full"
                  {...(previewing
                    ? {
                        backgroundColor:
                          "color-mix(in oklab, var(--color-primary) 16%, var(--color-base-100))",
                        textColor:
                          "color-mix(in oklab, var(--color-primary) 55%, var(--color-base-content))",
                      }
                    : // Muted like the plain button beside it until there is something to save.
                      { backgroundColor: "var(--color-base-200)" })}
                >
                  {previewing ? "按住保存" : "按住添加"}
                </HoldButton>
              </div>
              {full ? (
                <p className="px-1 text-xs text-base-content/70">
                  最多保存 {MAX_CUSTOM_THEMES} 个自定义主题。
                </p>
              ) : null}
            </div>
          </li>
          {customThemes.length ? (
            <>
              <li className="menu-title">我的主题</li>
              {customThemes.map((item) => (
                <li key={item.id} className="flex-row flex-nowrap items-center gap-1">
                  {choose(item.id, item.name, close)}
                  <button
                    type="button"
                    className="btn btn-square btn-ghost btn-xs"
                    aria-label={`删除主题 ${item.name}`}
                    title="删除主题"
                    onClick={() => removeCustomTheme(item.id)}
                  >
                    <Trash2Icon className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </>
          ) : null}
          <li className="menu-title">daisyUI 主题</li>
          {DAISY_THEMES.map((value) => (
            <li key={value}>{choose(value, themeLabel(value), close)}</li>
          ))}
        </>
      )}
    </DaisyDropdown>
  );
}
