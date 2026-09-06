import { ChartNoAxesCombined } from "lucide-react";
import { cn } from "@/lib/utils";

const sizes = {
  sm: "size-5 rounded-md [&_svg]:size-3.5",
  md: "size-9 rounded-lg [&_svg]:size-5",
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
      className={cn(
        "grid shrink-0 place-items-center bg-primary text-primary-foreground",
        sizes[size],
        className,
      )}
    >
      <ChartNoAxesCombined strokeWidth={2.5} />
    </span>
  );
}
