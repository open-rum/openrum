import * as React from "react";
import { cn } from "@/lib/utils";

/** daisyUI's `progress` on a native progress bar; a missing value shows it indeterminate. */
function Progress({
  className,
  value,
  max = 100,
  ...props
}: Omit<React.ComponentProps<"progress">, "value"> & { value?: number | null }) {
  return (
    <progress
      data-slot="progress"
      className={cn("progress progress-primary w-full", className)}
      value={value ?? undefined}
      max={max}
      {...props}
    />
  );
}

export { Progress };
