"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Switch as SwitchPrimitive } from "radix-ui";

/** daisyUI's `toggle` on the Radix switch; daisyUI moves the knob from `aria-checked`. */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn("toggle toggle-primary", size === "sm" ? "toggle-xs" : "toggle-sm", className)}
      {...props}
    />
  );
}

export { Switch };
