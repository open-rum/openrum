import { brandMarkPath, brandMarkViewBox } from "@openrum/design-tokens/brand";
import { cn } from "@/lib/utils";

const sizes = {
  sm: "size-5 [&_svg]:size-5",
  nav: "size-6 [&_svg]:size-6",
  md: "size-9 [&_svg]:size-9",
} as const;

export function BrandMark({
  size = "sm",
  className,
}: {
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="brand-mark"
      className={cn("grid shrink-0 place-items-center text-(--ds-logo)", sizes[size], className)}
    >
      <svg viewBox={brandMarkViewBox} fill="currentColor" focusable="false">
        <path d={brandMarkPath} />
        <path d={brandMarkPath} transform="rotate(180 20 20)" />
      </svg>
    </span>
  );
}
