import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Switches what a chart card shows (its metric or dimension). daisyUI's small boxed tabs:
 * the chosen option is a raised `tab-active` in the text colour, so the switch stays quieter
 * than the data it controls. Form choices keep `ToggleGroup`.
 */
export function ChartSwitch<Key extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly (readonly [Key, ReactNode])[];
  value: Key;
  onChange: (value: Key) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("tabs tabs-box tabs-xs w-fit flex-nowrap", className)}
      role="group"
      aria-label={label}
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={key === value}
          className={cn("tab gap-1.5 whitespace-nowrap", key === value && "tab-active")}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
