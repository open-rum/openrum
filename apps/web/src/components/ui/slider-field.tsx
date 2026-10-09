import { useState } from "react";
import { Slider } from "@/components/ui/slider";

/**
 * A labelled slider for bounded numbers in forms. It submits through a hidden input
 * named `name`, so FormData readers keep working, and shows the current value beside
 * the label. `format` renders the value (for example as a percentage); `scale` maps the
 * slider's integer steps to the submitted value, e.g. 100 for 0–1 rates in 1% steps.
 */
export function SliderField({
  name,
  label,
  hint,
  min,
  max,
  step = 1,
  scale = 1,
  defaultValue,
  format = (value) => String(value),
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step?: number;
  scale?: number;
  defaultValue: number;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="text-sm font-medium text-foreground">
      <span className="flex items-baseline justify-between gap-3">
        {label}
        <strong className="tabular-nums">{format(value)}</strong>
      </span>
      <Slider
        className="mt-4"
        min={min * scale}
        max={max * scale}
        step={step}
        value={[Math.round(value * scale)]}
        disabled={disabled}
        aria-label={label}
        onValueChange={([next]) => setValue(next / scale)}
      />
      <span className="mt-2 flex justify-between gap-3 text-xs font-normal text-muted-foreground">
        <span>{format(min)}</span>
        {hint ? <span>{hint}</span> : null}
        <span>{format(max)}</span>
      </span>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
