import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle({
  showLabel = false,
  compact = false,
}: {
  showLabel?: boolean;
  compact?: boolean;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const targetTheme = resolvedTheme === "dark" ? "light" : "dark";
  const TargetIcon = targetTheme === "dark" ? Moon : Sun;
  const targetLabel = targetTheme === "dark" ? "暗色模式" : "亮色模式";

  return (
    <Button
      variant={showLabel || compact ? "ghost" : "outline"}
      size={showLabel ? "default" : compact ? "icon" : "icon-lg"}
      type="button"
      aria-label={`切换至${targetLabel}`}
      title={showLabel ? undefined : `切换至${targetLabel}`}
      onClick={() => setTheme(targetTheme)}
    >
      <TargetIcon data-icon="inline-start" />
      {showLabel ? <span>切换至{targetLabel}</span> : null}
    </Button>
  );
}
