import { cva } from "class-variance-authority";

// daisyUI `btn`s that read as pressed. Plain toggles take `btn-active` from Radix's
// `data-state=on`; option cards (`selection`) take daisyUI's selected-card look instead, a
// primary border over a light primary tint, so the text inside them keeps its contrast.
export const toggleVariants = cva(
  "btn btn-ghost group/toggle gap-1 font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "data-[state=on]:btn-active aria-pressed:btn-active",
        outline: "border-base-300 data-[state=on]:btn-active aria-pressed:btn-active",
        selection:
          "border-base-300 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-base-content aria-pressed:border-primary aria-pressed:bg-primary/10",
        // Single-select segmented control: a `join-item` inside the group's `join`.
        segmented:
          "join-item btn-soft border-base-300 data-[state=on]:btn-primary data-[state=on]:btn-active",
        legend:
          "border-transparent bg-transparent font-normal text-base-content/70 shadow-none data-[state=on]:bg-transparent data-[state=off]:line-through data-[state=off]:opacity-50",
      },
      size: {
        default: "btn-sm",
        sm: "btn-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
