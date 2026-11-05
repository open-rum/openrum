import { cn } from "@/lib/utils";
import type { DaisyTheme } from "./daisyTheme";

/**
 * daisyUI's theme preview: base content, primary, secondary and accent drawn in the theme
 * itself. `lg` is the theme controller's icon; the default size sits in menu rows.
 */
export function ThemeSwatch({ theme, size = "sm" }: { theme: DaisyTheme; size?: "sm" | "lg" }) {
  const dot = "size-1.5 rounded-full";
  return (
    <span
      data-theme={theme}
      className={cn(
        "grid shrink-0 grid-cols-2 bg-base-100 shadow-sm",
        size === "lg"
          ? // 24px in all, so it fits inside a `btn-sm` (32px) with room around it.
            "gap-1 rounded-selector border border-base-content/10 p-[3px]"
          : "gap-0.5 rounded-md p-1",
      )}
      aria-hidden="true"
    >
      <span className={cn(dot, "bg-base-content")} />
      <span className={cn(dot, "bg-(--color-primary)")} />
      <span className={cn(dot, "bg-(--color-secondary)")} />
      <span className={cn(dot, "bg-(--color-accent)")} />
    </span>
  );
}
