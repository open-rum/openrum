import * as React from "react";
import { cn } from "@/lib/utils";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

/** daisyUI's `checkbox` on the Radix checkbox; daisyUI draws the mark from `aria-checked`. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn("checkbox checkbox-sm checkbox-primary", className)}
      {...props}
    />
  );
}

export { Checkbox };
