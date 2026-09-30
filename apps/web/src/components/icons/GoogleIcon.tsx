import { cn } from "@/lib/utils";

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <img
      src="/icons/google-g.png"
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0 object-contain", className)}
    />
  );
}
