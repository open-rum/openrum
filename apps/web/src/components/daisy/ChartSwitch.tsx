import type { ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem, type ToggleGroupColor } from "@/components/ui/toggle-group";

/**
 * Switches what a chart card shows (its metric, dimension or chart type). It is the shared
 * segmented control in its small size: a `base-200` track with a theme-coloured thumb sliding to
 * the chosen option, like every other single choice in the Console (user request, 2026-11-11).
 */
export function ChartSwitch<Key extends string>({
  label,
  options,
  value,
  onChange,
  className,
  color,
}: {
  label: string;
  options: readonly (readonly [Key, ReactNode])[];
  value: Key;
  onChange: (value: Key) => void;
  className?: string;
  color?: ToggleGroupColor;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      size="sm"
      color={color}
      aria-label={label}
      value={value}
      // Radix reports an empty value when the chosen option is clicked again; a chart always
      // shows something, so that click keeps the current choice.
      onValueChange={(next) => {
        if (next) onChange(next as Key);
      }}
      className={className}
    >
      {options.map(([key, text]) => (
        <ToggleGroupItem key={key} value={key} className="gap-1.5 whitespace-nowrap">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
