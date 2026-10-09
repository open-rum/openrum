import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        // A limitation that does not block the user, distinct from a failure.
        warning: "border-transparent bg-[var(--ds-warning-soft)] text-[var(--ds-warning)]",
        success:
          "border-[color-mix(in_srgb,var(--ds-success)_35%,var(--ds-border))] bg-[var(--ds-success-soft)] text-[var(--ds-success)]",
        outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-foreground underline-offset-4 hover:underline",
        // Colour-card badges: a soft tint with readable ink. `brand` follows the active
        // palette; the four hues stay fixed for categories that must not change colour.
        brand:
          "border-[var(--ds-primary-border)] bg-[var(--ds-primary-soft)] text-[var(--ds-primary-ink)]",
        amber:
          "border-[var(--ds-amber-border)] bg-[var(--ds-amber-soft)] text-[var(--ds-amber-ink)]",
        lime: "border-[var(--ds-lime-border)] bg-[var(--ds-lime-soft)] text-[var(--ds-lime-ink)]",
        sky: "border-[var(--ds-sky-border)] bg-[var(--ds-sky-soft)] text-[var(--ds-sky-ink)]",
        magenta:
          "border-[var(--ds-magenta-border)] bg-[var(--ds-magenta-soft)] text-[var(--ds-magenta-ink)]",
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
