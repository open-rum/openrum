import { useState } from "react";

/**
 * A labelled daisyUI `range` for bounded numbers in forms. It submits through a hidden input
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
    <div className="text-sm font-medium text-base-content">
      <span className="flex items-baseline justify-between gap-3">
        {label}
        <strong className="tabular-nums">{format(value)}</strong>
      </span>
      <input
        type="range"
        className="range range-primary range-xs mt-3 w-full"
        min={min * scale}
        max={max * scale}
        step={step}
        value={Math.round(value * scale)}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={format(value)}
        onChange={(event) => setValue(Number(event.target.value) / scale)}
      />
      {hint ? (
        <span className="mt-2 block text-xs font-normal text-base-content/70">{hint}</span>
      ) : null}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
