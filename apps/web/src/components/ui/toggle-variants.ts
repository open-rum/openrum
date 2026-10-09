import { cva } from "class-variance-authority";

export const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-full text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
        selection:
          "border border-input bg-transparent hover:bg-muted data-[state=on]:border-[var(--ds-selection-border)] data-[state=on]:bg-[var(--ds-selection)] data-[state=on]:text-[var(--ds-selection-foreground)] aria-pressed:border-[var(--ds-selection-border)] aria-pressed:bg-[var(--ds-selection)] aria-pressed:text-[var(--ds-selection-foreground)]",
        // Single-select segmented control: the selection is a SlidingIndicator behind the
        // options, so the options themselves stay transparent.
        segmented:
          "relative z-[1] bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent data-[state=on]:bg-transparent data-[state=on]:text-foreground",
        legend:
          "bg-transparent font-normal text-muted-foreground aria-pressed:bg-transparent data-[state=on]:bg-transparent data-[state=off]:line-through data-[state=off]:opacity-50",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
