import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// daisyUI's `btn`. The primary action is `btn-primary`; the neutral default `btn` carries
// secondary actions, and ghost, soft, error and link follow daisyUI's own modifiers.
const buttonVariants = cva(
  "btn group/button shrink-0 font-medium whitespace-nowrap has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "btn-primary",
        outline: "",
        secondary: "btn-soft",
        ghost: "btn-ghost",
        destructive: "btn-error btn-soft",
        link: "btn-link",
      },
      size: {
        default: "",
        xs: "btn-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "btn-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "btn-lg",
        icon: "btn-square",
        "icon-xs": "btn-square btn-xs [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "btn-square btn-sm",
        "icon-lg": "btn-square btn-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
