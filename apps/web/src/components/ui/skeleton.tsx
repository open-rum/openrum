import { cn } from "@/lib/utils";

/** daisyUI's `skeleton`. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("skeleton", className)} {...props} />;
}

export { Skeleton };
