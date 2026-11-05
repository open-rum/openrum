import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// daisyUI's `badge`. Tinted variants use `badge-soft`; the colour-card names map onto the
// theme's semantic colours so they follow whichever daisyUI theme is in effect.
const badgeVariants = cva(
  "badge badge-sm group/badge w-fit shrink-0 gap-1 font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "badge-primary",
        secondary: "badge-neutral badge-soft",
        destructive: "badge-error badge-soft",
        warning: "badge-warning badge-soft",
        success: "badge-success badge-soft",
        outline: "badge-outline",
        ghost: "badge-ghost",
        link: "badge-ghost underline-offset-4 hover:underline",
        brand: "badge-primary badge-soft",
        amber: "badge-warning badge-soft",
        lime: "badge-success badge-soft",
        sky: "badge-info badge-soft",
        magenta: "badge-secondary badge-soft",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge };
