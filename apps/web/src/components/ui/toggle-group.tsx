"use client";

import * as React from "react";
import { type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { toggleVariants } from "@/components/ui/toggle-variants";

export type ToggleGroupColor =
  "primary" | "secondary" | "accent" | "neutral" | "info" | "success" | "warning" | "error";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
});

function ToggleGroup({
  className,
  variant,
  size,
  color = "primary",
  style,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
    /** Selected fill and text use the matching daisyUI theme colour pair. */
    color?: ToggleGroupColor;
  }) {
  // Every horizontal single-select outline group is a segmented control: the options sit on
  // a `base-200` track and a semantic-colour thumb slides to the selected one.
  const segmented =
    props.type === "single" &&
    orientation === "horizontal" &&
    (variant === "outline" || variant === "segmented");
  const itemVariant = segmented ? "segmented" : variant;
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={itemVariant}
      data-size={size}
      data-color={segmented ? color : undefined}
      data-spacing={segmented ? "segmented" : spacing}
      data-orientation={orientation}
      style={
        {
          "--gap": segmented ? 0 : spacing,
          ...(segmented
            ? {
                "--segmented-color": `var(--color-${color})`,
                "--segmented-content": `var(--color-${color}-content)`,
              }
            : {}),
          ...style,
        } as React.CSSProperties
      }
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-full data-vertical:rounded-box data-vertical:flex-col data-vertical:items-stretch",
        segmented && "relative gap-0 rounded-[calc(var(--radius-field)+0.25rem)] bg-base-200 p-1",
        className,
      )}
      {...props}
    >
      {segmented ? <SegmentedThumb /> : null}
      <ToggleGroupContext.Provider
        value={{
          variant: itemVariant,
          size,
          spacing: segmented ? undefined : spacing,
          orientation,
        }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

/**
 * The sliding thumb behind the selected option. It follows the item whose `data-state` is
 * `on`, whether the group is controlled or not, and re-measures when the group resizes.
 * The first position is set without a transition; reduced motion turns the slide off.
 */
function SegmentedThumb() {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [box, setBox] = React.useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useLayoutEffect(() => {
    const group = ref.current?.parentElement;
    if (!group) return;
    const measure = () => {
      const item = group.querySelector<HTMLElement>(
        ':scope > [data-slot="toggle-group-item"][data-state="on"]',
      );
      setBox(item ? { left: item.offsetLeft, width: item.offsetWidth } : null);
    };
    measure();
    const frame = requestAnimationFrame(() => setReady(true));
    const mutations = new MutationObserver(measure);
    mutations.observe(group, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(group);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize?.disconnect();
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="toggle-group-thumb"
      className={cn(
        "pointer-events-none absolute inset-y-1 left-0 rounded-field bg-[var(--segmented-color,var(--color-primary))] shadow-sm",
        ready &&
          "transition-[translate,width,opacity] duration-300 ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none",
      )}
      style={{
        width: box?.width ?? 0,
        translate: `${box?.left ?? 0}px 0`,
        opacity: box ? 1 : 0,
      }}
    />
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-full group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-2xl group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-full group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-2xl group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
