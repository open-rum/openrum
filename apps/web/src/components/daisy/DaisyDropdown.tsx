import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * daisyUI's popover dropdown: the trigger opens a `menu` in the top layer, anchored to the
 * trigger with CSS anchor positioning. The menu stays inside the page's DOM, so it keeps the
 * page's daisyUI theme, and the top layer keeps it above neighbouring cards.
 */
export function DaisyDropdown({
  label,
  title,
  trigger,
  triggerClassName,
  menuClassName,
  placement = "end",
  disabled,
  children,
}: {
  label: string;
  title?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
  /** "end" aligns the menu to the trigger's right edge, "top-end" also opens it upwards. */
  placement?: "start" | "end" | "top-end";
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const id = `dropdown-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const anchor = `--${id}`;
  const close = () => document.getElementById(id)?.hidePopover?.();
  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        popoverTarget={id}
        aria-label={label}
        aria-haspopup="menu"
        title={title}
        disabled={disabled}
        style={{ anchorName: anchor } as CSSProperties}
      >
        {trigger}
      </button>
      <ul
        id={id}
        popover="auto"
        aria-label={label}
        className={cn(
          "dropdown menu rounded-box bg-base-100 p-2 shadow-lg",
          placement === "end" && "dropdown-end",
          placement === "top-end" && "dropdown-top dropdown-end",
          menuClassName,
        )}
        style={{ positionAnchor: anchor } as CSSProperties}
      >
        {children(close)}
      </ul>
    </>
  );
}
